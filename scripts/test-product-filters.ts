/**
 * Test bộ lọc mới của GET /products — kết nối DB THẬT, CHỈ ĐỌC
 * (synchronize: false, không ghi gì cả).
 *
 * Chạy: npm run test:product-filters
 */
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { Product } from '../src/products/product.entity';
import { ProductPriceHistory } from '../src/products/product-price-history.entity';
import { Brand } from '../src/brands/brand.entity';
import { Category } from '../src/categories/category.entity';
import { ProductService } from '../src/products/product.service';
import { typeOrmConfig } from '../src/config/typeorm.config';

async function main() {
  const dataSource = new DataSource({
    ...(typeOrmConfig as any),
    entities: [Product, ProductPriceHistory, Brand, Category],
    synchronize: false, // TUYỆT ĐỐI không đổi schema khi test
    logging: false,
    cache: false,
  });
  await dataSource.initialize();

  const service = new ProductService(
    dataSource.getRepository(Product),
    dataSource.getRepository(ProductPriceHistory),
    dataSource.getRepository(Brand),
    dataSource.getRepository(Category),
  );

  const expect = (cond: boolean, label: string) => {
    if (!cond) {
      console.error(`❌ FAIL: ${label}`);
      process.exitCode = 1;
    } else {
      console.log(`✅ ${label}`);
    }
  };

  // 1. Không filter — hoạt động như cũ
  const all = await service.findAll({ page: 1, pageSize: 5 });
  expect(all.total > 0, `không filter: ${all.total} sản phẩm`);

  // 2. Search nhiều token + relevance (SQL có relevance_score chạy được)
  const searched = await service.findAll({ search: 'mực in', pageSize: 5 });
  console.log(`   search "mực in": ${searched.total} kết quả, đầu tiên: ${searched.data[0]?.productCode} - ${searched.data[0]?.productName}`);
  expect(searched.total > 0, 'search nhiều token trả về kết quả');

  // 3. Search 1 token — so thứ tự relevance: tên khớp chính xác đứng trước
  const ranked = await service.findAll({ search: 'canon', pageSize: 10 });
  console.log(
    `   search "canon": top 3 = ${ranked.data
      .slice(0, 3)
      .map((p) => p.productCode)
      .join(', ')}`,
  );
  expect(ranked.total > 0, 'search 1 token chạy OK');

  // 4. Bộ lọc kết hợp: brand LIKE + còn hàng + khoảng giá + sort giá tăng dần
  const combo = await service.findAll({
    brand: 'canon',
    inStock: true,
    hasPrice: true,
    minPrice: 1000,
    maxPrice: 500000000,
    sort: 'price_asc',
    pageSize: 10,
  });
  const prices = combo.data.map((p) => p.price ?? 0);
  const sorted = [...prices].every(
    (v, i) => i === 0 || prices[i - 1] <= v,
  );
  console.log(`   combo: ${combo.total} sp, giá đầu/cuối trang: ${prices[0]} → ${prices[prices.length - 1]}`);
  expect(sorted, 'sort price_asc tăng dần đúng');
  expect(combo.data.every((p) => (p.stock ?? 0) > 0), 'inStock: mọi dòng còn hàng');

  // 5. hasWarranty
  const withWarranty = await service.findAll({ hasWarranty: true, pageSize: 1 });
  const withoutWarranty = await service.findAll({ hasWarranty: false, pageSize: 1 });
  console.log(`   có bảo hành: ${withWarranty.total}, chưa có: ${withoutWarranty.total}`);
  expect(
    withWarranty.data.every((p) => p.warrantyMonths !== null && p.warrantyMonths !== undefined),
    'hasWarranty=true: mọi dòng có warranty_months',
  );

  // 6. priceChanged giữ nguyên hoạt động
  const changed = await service.findAll({ priceChanged: true, pageSize: 5 });
  console.log(`   đã đổi giá: ${changed.total}`);
  expect(
    changed.data.every(
      (p) => p.previousPrice !== null && p.previousPrice !== p.price,
    ),
    'priceChanged: mọi dòng previous_price != price',
  );

  // 7. categoryId + sort name
  const anyProduct = all.data[0];
  if (anyProduct?.category?.id) {
    const byCat = await service.findAll({
      categoryId: anyProduct.category.id,
      sort: 'name_asc',
      pageSize: 10,
    });
    const names = byCat.data.map((p) => p.productName.toLowerCase());
    expect(
      names.every((n, i) => i === 0 || names[i - 1] <= n),
      'sort name_asc theo alphabet',
    );
  }

  await dataSource.destroy();
  if (process.exitCode !== 1) {
    console.log('\n🎉 TẤT CẢ TEST ĐẠT');
  }
}

main().catch((error) => {
  console.error('Test crashed:', error?.message || error);
  process.exit(1);
});
