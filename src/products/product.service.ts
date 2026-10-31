import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './product.entity';
import { ProductPriceHistory } from './product-price-history.entity';
import { Brand } from '../brands/brand.entity';
import { Category } from '../categories/category.entity';
import slugify from 'slugify';
import {
  getPermissions,
  getRoleNames,
} from '../common/utils/user-permission.helper';

/** Số token tối đa cho search — giống catalog báo giá. */
const MAX_SEARCH_TOKENS = 8;

/** Ký tự LIKE đặc biệt phải escape để search không bị lộ nghĩa. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(ProductPriceHistory)
    private readonly priceHistoryRepository: Repository<ProductPriceHistory>,
    @InjectRepository(Brand)
    private readonly brandRepo: Repository<Brand>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
  ) {}

  async findAll(filter?: {
    search?: string;
    brands?: string[]; // brand names (lowercased) — khớp chính xác, comma CSV
    brand?: string; // brand LIKE %...% — như catalog báo giá
    categoryIds?: number[];
    categoryId?: number; // 1 category duy nhất — như catalog báo giá
    page?: number;
    pageSize?: number;
    user?: any;
    pmCustomMode?: string; // 'true' hoặc 'false' để xác định chế độ PM
    pmPermissions?: string; // PM permissions từ frontend
    rolePermissions?: string; // Thông tin từng role từ frontend
    priceChanged?: boolean; // true = chỉ lấy sản phẩm từng đổi giá
    hasWarranty?: boolean; // true = có bảo hành (import Excel); false = chưa có
    inStock?: boolean; // true = còn hàng (stock > 0)
    hasPrice?: boolean; // true = có giá hợp lệ; false = không có giá
    minPrice?: number; // giá từ
    maxPrice?: number; // giá đến
    sort?: string; // price_asc|price_desc|stock_desc|updated_desc|name_asc|name_desc
  }) {
    const qb = this.productRepository
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.category', 'c')
      .leftJoinAndSelect('p.brand', 'b')
      .where('p.is_active = :isActive', { isActive: true });

    // PM scoping by explicit private permissions: pm_brand_<slug>, pm_cat_<slug>
    if (filter?.user) {
      const roles = getRoleNames(filter.user).map((r) =>
        String(r).toLowerCase(),
      );
      const isAdmin = roles.includes('admin');
      const isView = roles.includes('view');
      const isPM =
        roles.includes('pm') ||
        roles.some(
          (r) =>
            (r.startsWith('pm-') || r.startsWith('pm_')) &&
            !r.startsWith('view_'),
        );

      if (isPM && !isAdmin && !isView) {
        const rawPerms = getPermissions(filter.user).map((p) =>
          String(p || '').toLowerCase(),
        );
        const brandSlugs = rawPerms
          .filter((p) => p.startsWith('pm_brand_'))
          .map((p) => p.replace('pm_brand_', '').trim())
          .map((p) => slugify(p, { lower: true, strict: true }))
          .filter(Boolean);
        const categorySlugs = rawPerms
          .filter((p) => p.startsWith('pm_cat_'))
          .map((p) => p.replace('pm_cat_', '').trim())
          .map((p) => slugify(p, { lower: true, strict: true }))
          .filter(Boolean);

        const pmCustomMode = filter.pmCustomMode === 'true';

        if (pmCustomMode) {
          const allCombinations: string[] = [];
          const allSingleSlugs: string[] = [];

          // Parse rolePermissions từ query parameter thay vì từ database
          if (filter.rolePermissions) {
            try {
              const rolePermissionsData = JSON.parse(filter.rolePermissions);
              Object.entries(rolePermissionsData).forEach(
                ([roleName, roleData]: [string, any]) => {
                  const roleBrands = roleData.brands || [];
                  const roleCategories = roleData.categories || [];

                  // Convert permissions to slugs
                  const brandSlugs: string[] = [];
                  const categorySlugs: string[] = [];

                  roleBrands.forEach((brand: string) => {
                    if (brand.startsWith('pm_brand_')) {
                      const slug = slugify(brand.replace('pm_brand_', ''), {
                        lower: true,
                        strict: true,
                      });
                      brandSlugs.push(slug);
                    }
                  });

                  roleCategories.forEach((category: string) => {
                    if (category.startsWith('pm_cat_')) {
                      const slug = slugify(category.replace('pm_cat_', ''), {
                        lower: true,
                        strict: true,
                      });
                      categorySlugs.push(slug);
                    }
                  });

                  // Tổ hợp chỉ trong role này
                  if (categorySlugs.length > 0 && brandSlugs.length > 0) {
                    categorySlugs.forEach((cat) => {
                      brandSlugs.forEach((brand) => {
                        const combination = `${cat}+${brand}`;
                        allCombinations.push(combination);
                      });
                    });
                  } else {
                    // Role chỉ có 1 loại permission
                    const singleSlugs = [...categorySlugs, ...brandSlugs];
                    allSingleSlugs.push(...singleSlugs);
                  }
                },
              );
            } catch (error) {
              console.error(
                '❌ [Product PM Custom Mode] Error parsing rolePermissions:',
                error,
              );
            }
          }

          // Áp dụng filter
          if (allCombinations.length > 0) {
            qb.andWhere(
              'CONCAT(c.slug, "+", b.slug) IN (:...allCombinations)',
              { allCombinations },
            );
          }

          if (allSingleSlugs.length > 0) {
            qb.andWhere(
              '(b.slug IN (:...allSingleSlugs) OR c.slug IN (:...allSingleSlugs))',
              { allSingleSlugs },
            );
          }

          if (allCombinations.length === 0 && allSingleSlugs.length === 0) {
            return { data: [], total: 0 };
          }
        } else {
          // ✅ Chế độ tổ hợp chung: tổ hợp tự do như cũ
          // If no explicit pm_brand_/pm_cat_ permissions => deny (private mode requires explicit grants)
          if (brandSlugs.length === 0 && categorySlugs.length === 0) {
            qb.andWhere('1=0');
          } else {
            const brands = await this.brandRepo.find({
              select: ['id', 'name'],
            });
            const categories = await this.categoryRepo.find({
              select: ['id', 'catName'],
            });
            const allowedBrandIds = brands
              .filter((b) =>
                brandSlugs.includes(
                  slugify(b.name || '', { lower: true, strict: true }),
                ),
              )
              .map((b) => b.id);
            const allowedCategoryIds = categories
              .filter((c) =>
                categorySlugs.includes(
                  slugify(c.catName || '', { lower: true, strict: true }),
                ),
              )
              .map((c) => c.id);

            if (
              allowedBrandIds.length === 0 &&
              allowedCategoryIds.length === 0
            ) {
              qb.andWhere('1=0');
            } else if (
              allowedBrandIds.length > 0 &&
              allowedCategoryIds.length > 0
            ) {
              // Both brand & category permissions: require product matches BOTH (cartesian pairs logic)
              qb.andWhere(
                'b.id IN (:...allowedBrandIds) AND c.id IN (:...allowedCategoryIds)',
                { allowedBrandIds, allowedCategoryIds },
              );
            } else if (allowedBrandIds.length > 0) {
              qb.andWhere('b.id IN (:...allowedBrandIds)', { allowedBrandIds });
            } else if (allowedCategoryIds.length > 0) {
              qb.andWhere('c.id IN (:...allowedCategoryIds)', {
                allowedCategoryIds,
              });
            }
          }
        }
      }
    }

    if (filter?.brands && filter.brands.length > 0) {
      qb.andWhere('LOWER(b.name) IN (:...brands)', {
        brands: filter.brands.map((s) => s.toLowerCase()),
      });
    }

    if (filter?.categoryIds && filter.categoryIds.length > 0) {
      qb.andWhere('c.id IN (:...categoryIds)', {
        categoryIds: filter.categoryIds,
      });
    }

    // Sản phẩm từng đổi giá (cronjob hoặc sửa tay): previous_price != price.
    if (filter?.priceChanged === true) {
      qb.andWhere(
        '(p.previous_price IS NOT NULL AND p.price_changed_at IS NOT NULL AND p.previous_price <> p.price)',
      );
    }

    if (filter?.brand?.trim()) {
      qb.andWhere('LOWER(b.name) LIKE :brand', {
        brand: `%${escapeLikePattern(filter.brand.trim().toLowerCase())}%`,
      });
    }

    if (filter?.categoryId) {
      qb.andWhere('c.id = :categoryId', { categoryId: filter.categoryId });
    }

    if (filter?.inStock === true) {
      qb.andWhere('COALESCE(p.stock, 0) > 0');
    }

    if (filter?.hasPrice === true) {
      qb.andWhere('p.price IS NOT NULL AND p.price > 0');
    } else if (filter?.hasPrice === false) {
      qb.andWhere('(p.price IS NULL OR p.price <= 0)');
    }

    if (filter?.minPrice !== undefined) {
      qb.andWhere('p.price >= :minPrice', { minPrice: filter.minPrice });
    }
    if (filter?.maxPrice !== undefined) {
      qb.andWhere('p.price <= :maxPrice', { maxPrice: filter.maxPrice });
    }

    // Bảo hành: chỉ từ import Excel — lọc "có / chưa có bảo hành".
    if (filter?.hasWarranty === true) {
      qb.andWhere('p.warranty_months IS NOT NULL');
    } else if (filter?.hasWarranty === false) {
      qb.andWhere('p.warranty_months IS NULL');
    }

    // Sản phẩm từng đổi giá (cronjob hoặc sửa tay): previous_price != price.
    if (filter?.priceChanged === true) {
      qb.andWhere(
        '(p.previous_price IS NOT NULL AND p.price_changed_at IS NOT NULL AND p.previous_price <> p.price)',
      );
    }

    // Search theo token (giống catalog báo giá): mỗi token phải khớp ít nhất
    // một trường, xếp hạng theo độ khớp tên/mã.
    const searchPhrase = filter?.search?.trim().toLowerCase() ?? '';
    const tokens = searchPhrase
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, MAX_SEARCH_TOKENS);

    if (tokens.length > 0) {
      const relevanceParts: string[] = [];
      tokens.forEach((token, index) => {
        const key = `keyword${index}`;
        qb.andWhere(
          `(
            LOWER(p.product_name) LIKE :${key}
            OR LOWER(p.product_code) LIKE :${key}
            OR LOWER(b.name) LIKE :${key}
            OR LOWER(c.cat_name) LIKE :${key}
            OR LOWER(p.description) LIKE :${key}
          )`,
          { [key]: `%${escapeLikePattern(token)}%` },
        );

        relevanceParts.push(
          `(CASE WHEN LOWER(p.product_name) LIKE :${key} THEN 10 ELSE 0 END)`,
          `(CASE WHEN LOWER(p.product_code) LIKE :${key} THEN 8 ELSE 0 END)`,
        );
      });

      const likePhrase = escapeLikePattern(searchPhrase);
      relevanceParts.push(
        '(CASE WHEN LOWER(p.product_name) = :phraseExact THEN 50 ELSE 0 END)',
        '(CASE WHEN LOWER(p.product_code) = :phraseExact THEN 50 ELSE 0 END)',
        '(CASE WHEN LOWER(p.product_name) LIKE :phrasePrefix THEN 20 ELSE 0 END)',
      );

      qb.addSelect(
        `(${relevanceParts.join(' + ')})`,
        'relevance_score',
      ).setParameters({
        phraseExact: searchPhrase,
        phrasePrefix: `${likePhrase}%`,
      });
    }

    // Pagination
    const page = Math.max(1, Number(filter?.page) || 1);
    const pageSize = Math.max(1, Math.min(Number(filter?.pageSize) || 10, 200));
    qb.skip((page - 1) * pageSize).take(pageSize);

    // Sắp xếp: có search → relevance trước; `sort` chọn cột phụ (mặc định id
    // ASC như cũ để không phá FE hiện tại).
    const sortOptions: Record<string, [string, 'ASC' | 'DESC']> = {
      price_asc: ['p.price', 'ASC'],
      price_desc: ['p.price', 'DESC'],
      stock_desc: ['p.stock', 'DESC'],
      updated_desc: ['p.updatedAt', 'DESC'],
      name_asc: ['p.productName', 'ASC'],
      name_desc: ['p.productName', 'DESC'],
    };
    const [sortColumn, sortDirection] = sortOptions[filter?.sort ?? ''] ?? [
      'p.id',
      'ASC',
    ];

    if (tokens.length > 0) {
      qb.orderBy('relevance_score', 'DESC');
      qb.addOrderBy(sortColumn, sortDirection);
    } else {
      qb.orderBy(sortColumn, sortDirection);
    }
    qb.addOrderBy('p.id', 'ASC');

    const [rows, total] = await qb.getManyAndCount();
    return { data: rows, total, page, pageSize };
  }

  findOne(id: number) {
    return this.productRepository.findOne({
      where: { id },
      relations: ['category', 'brand'],
    });
  }

  create(data: Partial<Product>) {
    return this.productRepository.save(data);
  }

  async update(id: number, data: Partial<Product>) {
    const existing = await this.productRepository.findOne({
      where: { id },
      relations: ['brand', 'category'],
    });
    if (!existing) {
      throw new NotFoundException(`Không tìm thấy sản phẩm id=${id}`);
    }

    const { price, ...rest } = data;

    // Đổi giá tay qua API cũng ghi lịch sử biến động (source 'manual') để FE
    // sale thấy "giá đã biến động" như với giá đổi qua cronjob đồng bộ.
    if (price !== undefined && price !== null) {
      const numericPrice = Number(price);
      if (!Number.isFinite(numericPrice) || numericPrice < 0) {
        throw new BadRequestException(`Giá không hợp lệ: ${String(price)}`);
      }
    }

    const newPrice =
      price === undefined
        ? existing.price
        : price === null
          ? null
          : Number(price) || null;

    if (newPrice !== existing.price) {
      const oldPrice = existing.price ?? null;
      const changedAt = new Date();
      await this.priceHistoryRepository.save(
        this.priceHistoryRepository.create({
          productId: existing.id,
          productCode: existing.productCode,
          oldPrice,
          newPrice,
          changedAt,
          source: 'manual',
        }),
      );
      existing.previousPrice = oldPrice;
      existing.priceChangedAt = changedAt;
    }
    existing.price = newPrice;

    Object.assign(existing, rest);
    await this.productRepository.save(existing);
    return existing;
  }

  remove(id: number) {
    return this.productRepository.delete(id);
  }

  /**
   * Lịch sử biến động giá (mới nhất trước) — nguồn cho màn "giá đã biến động"
   * của sale. Lọc theo khoảng ngày / mã sản phẩm / nguồn thay đổi.
   */
  async findPriceChanges(filter?: {
    page?: number;
    pageSize?: number;
    from?: string;
    to?: string;
    productCode?: string;
    source?: string;
  }) {
    const qb = this.priceHistoryRepository
      .createQueryBuilder('h')
      .leftJoinAndSelect('h.product', 'p')
      .orderBy('h.changed_at', 'DESC')
      .addOrderBy('h.id', 'DESC');

    if (filter?.from && /^\d{4}-\d{2}-\d{2}$/.test(filter.from)) {
      qb.andWhere('h.changed_at >= :from', { from: `${filter.from} 00:00:00` });
    }
    if (filter?.to && /^\d{4}-\d{2}-\d{2}$/.test(filter.to)) {
      qb.andWhere('h.changed_at <= :to', { to: `${filter.to} 23:59:59` });
    }
    if (filter?.productCode && filter.productCode.trim().length > 0) {
      qb.andWhere('LOWER(h.product_code) LIKE :code', {
        code: `%${filter.productCode.trim().toLowerCase()}%`,
      });
    }
    if (filter?.source && ['sync', 'manual'].includes(filter.source)) {
      qb.andWhere('h.source = :source', { source: filter.source });
    }

    const page = Math.max(1, Number(filter?.page) || 1);
    const pageSize = Math.max(1, Math.min(Number(filter?.pageSize) || 20, 200));
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [rows, total] = await qb.getManyAndCount();
    return { data: rows, total, page, pageSize };
  }
}
