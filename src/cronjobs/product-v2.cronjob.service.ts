import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NKCProduct } from '../nkc_products/nkc_product.entity';
import { Product } from '../products/product.entity';
import { Brand } from '../brands/brand.entity';
import { Category } from '../categories/category.entity';
import { PermissionService } from '../permissions/permission.service';
import slugify from 'slugify';
import { WinstonLogger } from '../common/winston.logger';

@Injectable()
export class ProductV2CronjobService {
  private readonly logger = new WinstonLogger(ProductV2CronjobService.name);

  constructor(
    private readonly httpService: HttpService,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Brand)
    private readonly brandRepo: Repository<Brand>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    private readonly permissionService: PermissionService,
  ) {}

  @Cron(process.env.CRON_PRODUCT_TIME || '0 22 * * *')
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
              const foundBrand = await this.brandRepo.findOne({
                where: { name: String(brandName) },
              });
              brand = foundBrand ?? undefined;
              // Ensure existing brand has a proper slug; update if needed
              if (brand) {
                try {
                  const expectedSlug = slugify(String(brandName).replace(/[đĐ]/g, 'd'), { lower: true, strict: true }).slice(0, 255);
                  if ((brand as any).slug !== expectedSlug) {
                    // check slug conflict
                    const conflict = await this.brandRepo.findOne({ where: { slug: expectedSlug } });
                    if (conflict && conflict.id !== brand.id) {
                      this.logger.warn(`Slug conflict for brand '${brandName}': desired slug '${expectedSlug}' already used by id=${conflict.id}. Skipping slug update.`);
                    } else {
                      const oldSlug = (brand as any).slug || '';
                      await this.brandRepo.update({ id: brand.id }, { slug: expectedSlug } as Partial<Brand>);
                      // rename permission from old to new
                      try {
                        if (oldSlug) {
                          await this.permissionService.updatePermissionNameBySlug(`pm_brand_${oldSlug}`, `pm_brand_${expectedSlug}`);
                        } else {
                          // create permission if none existed for this brand
                          await this.permissionService.createPermission({ name: `pm_brand_${expectedSlug}`, action: 'scope' });
                        }
                      } catch (permErr) {
                        this.logger.debug(`Failed to update/create permission for brand '${brandName}': ${permErr?.message || permErr}`);
                      }
                      // refresh brand object
                      brand = await this.brandRepo.findOne({ where: { id: brand.id } }) ?? undefined;
                    }
                  }
                } catch (e) {
                  this.logger.debug(`Failed to ensure slug for existing brand '${brandName}': ${e?.message || e}`);
                }
                // Ensure permission exists for this brand (create if missing)
                try {
                  const ensuredSlug = slugify(String(brandName).replace(/[đĐ]/g, 'd'), { lower: true, strict: true }).slice(0, 255);
                  await this.permissionService.createPermission({ name: `pm_brand_${ensuredSlug}`, action: 'scope' });
                } catch (permErr) {
                  this.logger.debug(`Failed to create/check permission for existing brand '${brandName}': ${permErr?.message || permErr}`);
                }
              }
              if (!brand) {
                try {
                  const slug = slugify(String(brandName).replace(/[đĐ]/g, 'd'), { lower: true, strict: true }).slice(0, 255);
                  brand = await this.brandRepo.save({
                    name: String(brandName).slice(0, 255),
                    slug,
                  } as Brand);
                  try {
                    await this.permissionService.createPermission({
                      name: `pm_brand_${slug}`,
                      action: 'scope',
                    });
                  } catch (permErr) {
                    this.logger.debug(
                      `Failed to create permission for brand '${brandName}': ${permErr?.message || permErr}`,
                    );
                  }
                } catch (e) {
                  this.logger.debug(
                    `Failed to create brand '${brandName}': ${e?.message || e}`,
                  );
                }
              }
            }

            let category: Category | undefined;
            if (categoryName) {
              const foundCategory = await this.categoryRepo.findOne({
                where: { catName: String(categoryName) },
              });
              category = foundCategory ?? undefined;
              // Ensure existing category has a proper slug; update if needed
              if (category) {
                try {
                  const expectedSlug = slugify(String(categoryName).replace(/[đĐ]/g, 'd'), { lower: true, strict: true }).slice(0, 255);
                  if ((category as any).slug !== expectedSlug) {
                    const conflict = await this.categoryRepo.findOne({ where: { slug: expectedSlug } });
                    if (conflict && conflict.id !== category.id) {
                      this.logger.warn(`Slug conflict for category '${categoryName}': desired slug '${expectedSlug}' already used by id=${conflict.id}. Skipping slug update.`);
                    } else {
                      const oldSlug = (category as any).slug || '';
                      await this.categoryRepo.update({ id: category.id }, { slug: expectedSlug } as Partial<Category>);
                      try {
                        if (oldSlug) {
                          await this.permissionService.updatePermissionNameBySlug(`pm_cat_${oldSlug}`, `pm_cat_${expectedSlug}`);
                        } else {
                          await this.permissionService.createPermission({ name: `pm_cat_${expectedSlug}`, action: 'scope' });
                        }
                      } catch (permErr) {
                        this.logger.debug(`Failed to update/create permission for category '${categoryName}': ${permErr?.message || permErr}`);
                      }
                      category = await this.categoryRepo.findOne({ where: { id: category.id } }) ?? undefined;
                    }
                  }
                } catch (e) {
                  this.logger.debug(`Failed to ensure slug for existing category '${categoryName}': ${e?.message || e}`);
                }
                  // Ensure permission exists for this category (create if missing)
                  try {
                    const ensuredSlug = slugify(String(categoryName).replace(/[đĐ]/g, 'd'), { lower: true, strict: true }).slice(0, 255);
                    await this.permissionService.createPermission({ name: `pm_cat_${ensuredSlug}`, action: 'scope' });
                  } catch (permErr) {
                    this.logger.debug(`Failed to create/check permission for existing category '${categoryName}': ${permErr?.message || permErr}`);
                  }
              }
              if (!category) {
                try {
                  const slug = slugify(String(categoryName).replace(/[đĐ]/g, 'd'), { lower: true, strict: true }).slice(0, 255);
                  category = await this.categoryRepo.save({
                    catName: String(categoryName).slice(0, 255),
                    slug,
                  } as Category);
                  try {
                    await this.permissionService.createPermission({
                      name: `pm_cat_${slug}`,
                      action: 'scope',
                    });
                  } catch (permErr) {
                    this.logger.debug(
                      `Failed to create permission for category '${categoryName}': ${permErr?.message || permErr}`,
                    );
                  }
                } catch (e) {
                  this.logger.debug(
                    `Failed to create category '${categoryName}': ${e?.message || e}`,
                  );
                }
              }
            }

            const payload: Partial<Product> = {
              productCode: productCode,
              // product_name column is NOT NULL in the DB: fallback to original name or 'Unknown Product'
              productName: productName
                ? String(productName)
                : 'Unknown Product',
              description: description ? String(description) : undefined,
            };

            if (!productCode) {
              this.logger.debug('Skipping product without MaHH/product code');
              continue;
            }

            const existing = await this.productRepo.findOne({
              where: { productCode },
              relations: ['brand', 'category'],
            });

            if (existing) {
              // determine if any relevant field changed
              const existingBrandId = (existing as any).brand ? (existing as any).brand.id : undefined;
              const existingCategoryId = (existing as any).category ? (existing as any).category.id : undefined;
              const newBrandId = brand ? (brand as any).id : undefined;
              const newCategoryId = category ? (category as any).id : undefined;

              const nameChanged = (existing.productName || '') !== (payload.productName || '');
              const descChanged = (existing.description || '') !== (payload.description || '');
              const brandChanged = existingBrandId !== newBrandId;
              const categoryChanged = existingCategoryId !== newCategoryId;

              if (nameChanged || descChanged || brandChanged || categoryChanged) {
                // apply changes and save
                existing.productName = payload.productName as string;
                existing.description = payload.description as string | undefined;
                (existing as any).brand = brand ?? undefined;
                (existing as any).category = category ?? undefined;
                await this.productRepo.save(existing as Product);
              } else {
                // nothing to update
                this.logger.debug(`Product ${productCode} unchanged, skipping save`);
              }
            } else {
              // new product
              const toSave = Object.assign({}, payload, {
                brand: brand ?? undefined,
                category: category ?? undefined,
              });
              await this.productRepo.save(toSave as Product);
            }
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
