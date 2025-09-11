import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NKCProduct } from '../nkc_products/nkc_product.entity';
import { Product } from '../products/product.entity';
import { Brand } from '../brands/brand.entity';
import { Category } from '../categories/category.entity';

@Injectable()
export class ProductV2CronjobService {
  private readonly logger = new Logger(ProductV2CronjobService.name);

  constructor(
    private readonly httpService: HttpService,
  @InjectRepository(Product)
  private readonly productRepo: Repository<Product>,
  @InjectRepository(Brand)
  private readonly brandRepo: Repository<Brand>,
  @InjectRepository(Category)
  private readonly categoryRepo: Repository<Category>,
  ) {}

  @Cron(process.env.CRON_PRODUCT_TIME || '0 0 * * *')
  async syncProductsV2() {
    const apiUrl = process.env.VNK_API_PRODUCT_URL_V2;
    const token = process.env.VNK_API_TOKEN;

    if (!apiUrl) {
      this.logger.warn(
        'VNK_API_PRODUCT_URL_V2 not configured - skipping product-v2 cron',
      );
      return;
    }

    if (!token) {
      this.logger.warn(
        'VNK_API_TOKEN not configured - skipping product-v2 cron',
      );
      return;
    }

    this.logger.log(`Start sync products from V2 API: ${apiUrl}`);

    try {
      // Start from page 1 and iterate until last_page
      let page = 1;
      while (true) {
        const url = `${apiUrl}?page=${page}`;
        this.logger.log(`Fetching page ${page} -> ${url}`);

        const response$ = this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          timeout: 30_000,
        });

        const resp = await lastValueFrom(response$);
        const body = resp.data;

        if (!body || !body.data) {
          this.logger.warn(`Empty response or missing data on page ${page}`);
          break;
        }

        const items: any[] = body.data || [];
        this.logger.log(`Page ${page} returned ${items.length} products`);

        for (const item of items) {
          try {
            // Map fields: MaHH -> productCode, Description -> productName or description
            const productCode = item.MaHH || item.mahh || item.code || null;
            const productName = item.Name || item.ProductName || null;
            const description = item.Description || null;

            // Resolve brand (create if missing) and category (attach if exists)
            const brandName = item.Brand || null;
            const categoryName = item.ProductGroup || null;

            let brand: Brand | undefined;
            if (brandName) {
              const foundBrand = await this.brandRepo.findOne({ where: { name: String(brandName) } });
              brand = foundBrand ?? undefined;
              if (!brand) {
                try {
                  const slug = String(brandName).toLowerCase().replace(/\s+/g, '-').slice(0, 255);
                  brand = await this.brandRepo.save({ name: String(brandName).slice(0, 255), slug } as Brand);
                } catch (e) {
                  this.logger.debug(`Failed to create brand '${brandName}': ${e?.message || e}`);
                }
              }
            }

            let category: Category | undefined;
            if (categoryName) {
              const foundCategory = await this.categoryRepo.findOne({ where: { catName: String(categoryName) } });
              category = foundCategory ?? undefined;
              if (!category) {
                try {
                  const slug = String(categoryName).toLowerCase().replace(/\s+/g, '-').slice(0, 255);
                  category = await this.categoryRepo.save({ catName: String(categoryName).slice(0, 255), slug } as Category);
                } catch (e) {
                  this.logger.debug(`Failed to create category '${categoryName}': ${e?.message || e}`);
                }
              }
            }

            const payload: Partial<Product> = {
              productCode: productCode,
              // product_name column is NOT NULL in the DB: fallback to original name or 'Unknown Product'
              productName: productName ? String(productName) : 'Unknown Product',
              description: description ? String(description) : undefined,
            };

            if (!productCode) {
              this.logger.debug('Skipping product without MaHH/product code');
              continue;
            }

            const existing = await this.productRepo.findOne({ where: { productCode } });
            // merge relations into the object we will save
            const toSave = existing
              ? Object.assign({}, existing, payload, { brand: brand ?? undefined, category: category ?? undefined })
              : Object.assign({}, payload, { brand: brand ?? undefined, category: category ?? undefined });

            await this.productRepo.save(toSave as Product);
          } catch (innerErr) {
            this.logger.error('Error upserting product', innerErr);
          }
        }

        const meta = body.meta || {};
        const currentPage = meta.current_page || page;
        const lastPage = meta.last_page || currentPage;

        if (currentPage >= lastPage) break;
        page += 1;
      }

      this.logger.log('Finished sync products V2');
    } catch (error) {
      this.logger.error('Failed to sync products V2', error);
    }
  }
}
