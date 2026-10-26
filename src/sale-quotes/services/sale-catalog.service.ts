import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Product } from '../../products/product.entity';
import { CatalogQueryDto, PricingPreviewDto } from '../dto/settings.dto';
import { SalePricingService } from './sale-pricing.service';
import { SaleSettingsService } from './sale-settings.service';
import { getUserId } from '../utils/entity-access.util';
import { stripHtml } from '../utils/text.util';

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

    if (query.search?.trim()) {
      const keyword = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        `(LOWER(p.product_code) LIKE :keyword
          OR LOWER(p.product_name) LIKE :keyword
          OR LOWER(p.description) LIKE :keyword
          OR LOWER(b.name) LIKE :keyword
          OR LOWER(c.cat_name) LIKE :keyword)`,
        { keyword },
      );
    }

    if (query.brand?.trim()) {
      qb.andWhere('LOWER(b.name) LIKE :brand', {
        brand: `%${query.brand.trim().toLowerCase()}%`,
      });
    }

    if (query.categoryId) {
      qb.andWhere('c.id = :categoryId', { categoryId: query.categoryId });
    }

    if (query.inStock) {
      qb.andWhere('COALESCE(p.stock, 0) > 0');
    }

    switch (query.sort) {
      case 'price_asc':
        qb.orderBy('p.price', 'ASC');
        break;
      case 'price_desc':
        qb.orderBy('p.price', 'DESC');
        break;
      case 'stock_desc':
        qb.orderBy('p.stock', 'DESC');
        break;
      case 'updated_desc':
        qb.orderBy('p.updated_at', 'DESC');
        break;
      case 'name_asc':
      default:
        qb.orderBy('p.product_name', 'ASC');
        break;
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
      pricingRules: rules,
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
      pricingRules: rules,
      items: dto.items.map((item) => {
        const product = item.productId
          ? productMap.get(Number(item.productId))
          : undefined;
        const costPrice =
          item.costPrice !== undefined && item.costPrice !== null
            ? Number(item.costPrice)
            : product?.price ?? null;
        const salePrice = this.pricingService.suggestSalePrice(costPrice, rules);
        const customerPrice = this.pricingService.customerPrice(
          salePrice,
          rules,
        );
        return {
          productId: product?.id ?? item.productId ?? null,
          productCode: product?.productCode ?? null,
          productName: product?.productName ?? null,
          costPrice,
          suggestedPrice: salePrice,
          customerPrice,
          marginAmount: this.pricingService.marginAmount(salePrice, costPrice),
          marginPercent: this.pricingService.marginPercent(salePrice, costPrice),
          quantity: Math.max(1, Number(item.quantity) || 1),
        };
      }),
    };
  }

  private mapProduct(product: Product, rules: any, includeDescription: boolean) {
    const costPrice =
      product.price === null || product.price === undefined
        ? null
        : Number(product.price);
    const suggestedPrice = this.pricingService.suggestSalePrice(
      costPrice,
      rules,
    );
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
