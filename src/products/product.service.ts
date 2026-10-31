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
    brands?: string[]; // brand names (lowercased)
    categoryIds?: number[];
    page?: number;
    pageSize?: number;
    user?: any;
    pmCustomMode?: string; // 'true' hoặc 'false' để xác định chế độ PM
    pmPermissions?: string; // PM permissions từ frontend
    rolePermissions?: string; // Thông tin từng role từ frontend
    priceChanged?: boolean; // true = chỉ lấy sản phẩm từng đổi giá
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

    if (filter?.search && filter.search.trim().length > 0) {
      // Normalize search for accent-insensitive contains
      const s = filter.search.trim().toLowerCase();
      // Use MySQL utf8_general_ci (or database default) by applying LOWER and LIKE
      qb.andWhere(
        `(
          LOWER(p.product_name) LIKE :kw
          OR LOWER(p.product_code) LIKE :kw
          OR LOWER(b.name) LIKE :kw
          OR LOWER(c.cat_name) LIKE :kw
          OR LOWER(p.description) LIKE :kw
        )`,
        { kw: `%${s}%` },
      );
    }

    // Pagination
    const page = Math.max(1, Number(filter?.page) || 1);
    const pageSize = Math.max(1, Math.min(Number(filter?.pageSize) || 10, 200));
    qb.skip((page - 1) * pageSize).take(pageSize);

    qb.orderBy('p.id', 'ASC');

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
