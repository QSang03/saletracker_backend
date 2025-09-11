import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Product } from './product.entity';
import { Brand } from '../brands/brand.entity';
import { Category } from '../categories/category.entity';
import slugify from 'slugify';
import { getPermissions, getRoleNames } from '../common/utils/user-permission.helper';

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
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
  }) {
    const qb = this.productRepository
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.category', 'c')
      .leftJoinAndSelect('p.brand', 'b');

    // PM scoping by explicit private permissions: pm_brand_<slug>, pm_cat_<slug>
    if (filter?.user) {
      const roles = getRoleNames(filter.user).map(r => String(r).toLowerCase());
      const isAdmin = roles.includes('admin');
      const isView = roles.includes('view');
      const isPM = roles.includes('pm') || roles.some(r => r.startsWith('pm-') || r.startsWith('pm_'));
      if (isPM && !isAdmin && !isView) {
        const rawPerms = getPermissions(filter.user).map(p => String(p || '').toLowerCase());
        const brandSlugs = rawPerms
          .filter(p => p.startsWith('pm_brand_'))
            .map(p => p.replace('pm_brand_', '').trim())
            .map(p => slugify(p, { lower: true, strict: true }))
            .filter(Boolean);
        const categorySlugs = rawPerms
          .filter(p => p.startsWith('pm_cat_'))
            .map(p => p.replace('pm_cat_', '').trim())
            .map(p => slugify(p, { lower: true, strict: true }))
            .filter(Boolean);

        // If no explicit pm_brand_/pm_cat_ permissions => deny (private mode requires explicit grants)
        if (brandSlugs.length === 0 && categorySlugs.length === 0) {
          qb.andWhere('1=0');
        } else {
          const brands = await this.brandRepo.find({ select: ['id', 'name'] });
          const categories = await this.categoryRepo.find({ select: ['id', 'catName'] });
          const allowedBrandIds = brands
            .filter(b => brandSlugs.includes(slugify(b.name || '', { lower: true, strict: true })))
            .map(b => b.id);
          const allowedCategoryIds = categories
            .filter(c => categorySlugs.includes(slugify(c.catName || '', { lower: true, strict: true })))
            .map(c => c.id);

          if (allowedBrandIds.length === 0 && allowedCategoryIds.length === 0) {
            qb.andWhere('1=0');
          } else if (allowedBrandIds.length > 0 && allowedCategoryIds.length > 0) {
            // Both brand & category permissions: require product matches BOTH (cartesian pairs logic)
            qb.andWhere('b.id IN (:...allowedBrandIds) AND c.id IN (:...allowedCategoryIds)', { allowedBrandIds, allowedCategoryIds });
          } else if (allowedBrandIds.length > 0) {
            qb.andWhere('b.id IN (:...allowedBrandIds)', { allowedBrandIds });
          } else if (allowedCategoryIds.length > 0) {
            qb.andWhere('c.id IN (:...allowedCategoryIds)', { allowedCategoryIds });
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

  update(id: number, data: Partial<Product>) {
    return this.productRepository.update(id, data);
  }

  remove(id: number) {
    return this.productRepository.delete(id);
  }
}
