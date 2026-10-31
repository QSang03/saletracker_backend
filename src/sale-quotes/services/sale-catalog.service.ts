import { PricingRules } from '../sale-quote.constants';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Product } from '../../products/product.entity';
import { CatalogQueryDto, PricingPreviewDto } from '../dto/settings.dto';
import { SalePricingService } from './sale-pricing.service';
import { SaleSettingsService } from './sale-settings.service';
import { getUserId } from '../utils/entity-access.util';
import { stripHtml } from '../utils/text.util';

const MAX_SEARCH_TOKENS = 8;

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

@Injectable()
export class SaleCatalogService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly pricingService: SalePricingService,
    private readonly settingsService: SaleSettingsService,
  ) {}

  async search(query: CatalogQueryDto, user: any) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(
      1,
      Math.min(Number(query.pageSize) || 20, 100),
    );

    const qb = this.productRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.brand', 'b')
      .leftJoinAndSelect('p.category', 'c')
      .where('p.is_active = :active', { active: true });

    const searchPhrase = query.search?.trim().toLowerCase() ?? '';
    const tokens = searchPhrase
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, MAX_SEARCH_TOKENS);

    if (tokens.length > 0) {
      const relevanceParts: string[] = [];
      tokens.forEach((token, index) => {
        const key = `keyword${index}`;
        qb.andWhere(
          `(LOWER(p.product_code) LIKE :${key}
            OR LOWER(p.product_name) LIKE :${key})`,
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

    if (query.brand?.trim()) {
      qb.andWhere('LOWER(b.name) LIKE :brand', {
        brand: `%${escapeLikePattern(query.brand.trim().toLowerCase())}%`,
      });
    }

    if (query.categoryId) {
      qb.andWhere('c.id = :categoryId', { categoryId: query.categoryId });
    }

    if (query.inStock) {
      qb.andWhere('COALESCE(p.stock, 0) > 0');
    }

    if (query.hasPrice === true) {
      qb.andWhere('p.price IS NOT NULL AND p.price > 0');
    } else if (query.hasPrice === false) {
      qb.andWhere('(p.price IS NULL OR p.price <= 0)');
    }

    if (query.minPrice !== undefined) {
      qb.andWhere('p.price >= :minPrice', { minPrice: query.minPrice });
    }

    if (query.maxPrice !== undefined) {
      qb.andWhere('p.price <= :maxPrice', { maxPrice: query.maxPrice });
    }

    const sortOptions: Record<string, [string, 'ASC' | 'DESC']> = {
      price_asc: ['p.price', 'ASC'],
      price_desc: ['p.price', 'DESC'],
      stock_desc: ['p.stock', 'DESC'],
      updated_desc: ['p.updatedAt', 'DESC'],
      name_asc: ['p.productName', 'ASC'],
    };
    const [sortColumn, sortDirection] = sortOptions[query.sort ?? ''] ?? [
      'p.productName',
      'ASC',
    ];

    if (tokens.length > 0) {
      qb.orderBy('relevance_score', 'DESC');
      qb.addOrderBy(sortColumn, sortDirection);
    } else {
      qb.orderBy(sortColumn, sortDirection);
    }
    qb.addOrderBy('p.id', 'ASC');
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [rows, total] = await qb.getManyAndCount();
    const rules = await this.settingsService.getEffectiveRules(
      getUserId(user),
    );

    return {
      data: rows.map((product) => this.mapProduct(product, rules, false)),
      total,
      page,
      pageSize,
    };
  }

  async findOne(productId: number, user: any) {
    const product = await this.productRepo.findOne({
      where: { id: productId },
      relations: ['brand', 'category'],
    });
    if (!product) {
      throw new NotFoundException('Sản phẩm không tồn tại');
    }

    const rules = await this.settingsService.getEffectiveRules(
      getUserId(user),
    );
    return {
      ...this.mapProduct(product, rules, true),
      descriptionHtml: product.description ?? null,
    };
  }

  async previewPricing(dto: PricingPreviewDto, user: any) {
    const rules = await this.settingsService.getEffectiveRules(
      getUserId(user),
    );
    const productIds = dto.items
      .map((item) => Number(item.productId))
      .filter((id) => Number.isFinite(id) && id > 0);

    const products =
      productIds.length > 0
        ? await this.productRepo.find({ where: { id: In(productIds) } })
        : [];
    const productMap = new Map(products.map((product) => [product.id, product]));

    return {
      items: dto.items.map((item) => {
        const product = item.productId
          ? productMap.get(Number(item.productId))
          : undefined;
        const costPrice =
          item.costPrice !== undefined && item.costPrice !== null
            ? Number(item.costPrice)
            : product?.price ?? null;
        const salePrice = costPrice;
        return {
          productId: product?.id ?? item.productId ?? null,
          productCode: product?.productCode ?? null,
          productName: product?.productName ?? null,
          costPrice,
          suggestedPrice: salePrice,
          marginAmount: this.pricingService.marginAmount(salePrice, costPrice),
          marginPercent: this.pricingService.marginPercent(salePrice, costPrice),
          quantity: Math.max(1, Number(item.quantity) || 1),
        };
      }),
    };
  }

  private mapProduct(product: Product, rules: PricingRules, includeDescription: boolean) {
    const costPrice =
      product.price === null || product.price === undefined
        ? null
        : Number(product.price);
    const suggestedPrice = costPrice;
    const descriptionText = stripHtml(product.description);

    return {
      id: product.id,
      productCode: product.productCode,
      productName: product.productName,
      descriptionText: includeDescription
        ? descriptionText
        : descriptionText.slice(0, 300),
      brand: product.brand
        ? { id: product.brand.id, name: product.brand.name }
        : null,
      category: product.category
        ? {
            id: product.category.id,
            catName: product.category.catName,
          }
        : null,
      costPrice,
      suggestedPrice,
      displayPrice: suggestedPrice,
      marginAmount: this.pricingService.marginAmount(
        suggestedPrice,
        costPrice,
      ),
      marginPercent: this.pricingService.marginPercent(
        suggestedPrice,
        costPrice,
      ),
      warranty: null,
      stock: product.stock ?? 0,
      isInStock: product.isInStock ?? false,
      isActive: product.isActive,
      syncedAt: product.syncedAt ?? null,
      updatedAt: product.updatedAt,
    };
  }
}
