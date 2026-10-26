import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Product } from '../products/product.entity';
import { Brand } from '../brands/brand.entity';
import { Category } from '../categories/category.entity';
import { PermissionService } from '../permissions/permission.service';
import slugify from 'slugify';
import { WinstonLogger } from '../common/winston.logger';

interface ApiProduct {
  MaHH?: string | null;
  Name?: string | null;
  Description?: string | null;
  Price?: number | string | null;
  Stock?: boolean | number | string | null;
  SLCoTheXuat?: number | string | null;
  Brand?: string | null;
  ProductGroup?: string | null;
  properties?: unknown[];
}

interface ApiResponse {
  status?: boolean;
  message?: string;
  data?: {
    items?: ApiProduct[];
    pagination?: {
      total?: number;
      perPage?: number;
      currentPage?: number;
      lastPage?: number;
    };
  };
}

interface PageStats {
  created: number;
  updated: number;
  unchanged: number;
}

@Injectable()
export class ProductV2CronjobService {
  private readonly logger = new WinstonLogger(ProductV2CronjobService.name);
  private isRunning = false;

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

  @Cron(process.env.CRON_PRODUCT_TIME || '0 */6 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async syncProductsV2() {
    if (this.isRunning) {
      this.logger.warn('Previous product sync is still running - skipping');
      return;
    }

    if (process.env.DISABLE_CRON_PRODUCT_V2 === 'true') {
      this.logger.warn(
        'product-v2 cronjob temporarily disabled via DISABLE_CRON_PRODUCT_V2',
      );
      return;
    }

    const apiUrl = process.env.VNK_API_PRODUCT_URL_V2;
    const token = process.env.VNK_API_TOKEN;

    if (!apiUrl) {
      this.logger.warn(
        'VNK_API_PRODUCT_URL_V2 not configured - skipping product-v2 cron',
      );
      return;
    }

    this.isRunning = true;
    // Truncate to seconds because products.synced_at is DATETIME(0).
    const runStartedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const pageSize = this.getIntEnv('PRODUCT_SYNC_PAGE_SIZE', 500);
    const delayMs = this.getIntEnv('PRODUCT_SYNC_DELAY_MS', 1000);
    const maxRetries = this.getIntEnv('PRODUCT_SYNC_MAX_RETRIES', 5);
    const deactivateMissing =
      (process.env.PRODUCT_SYNC_DEACTIVATE_MISSING || 'false') === 'true';

    let page = 1;
    let lastPage = 1;
    let totalFetched = 0;
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    this.logger.log(
      `Start product sync from: ${apiUrl} (pageSize=${pageSize})`,
    );

    try {
      const brandCache = new Map<string, Brand>();
      const categoryCache = new Map<string, Category>();
      await this.loadBrandCategoryCache(brandCache, categoryCache);

      do {
        const body = await this.fetchPage(
          apiUrl,
          token,
          page,
          pageSize,
          maxRetries,
        );
        const items = body.data?.items ?? [];
        const pagination = body.data?.pagination ?? {};

        const apiLastPage = Number(pagination.lastPage);
        if (Number.isFinite(apiLastPage) && apiLastPage > 0) {
          lastPage = apiLastPage;
        }

        if (!Array.isArray(items) || items.length === 0) {
          this.logger.warn(
            `Page ${page}/${lastPage} returned no items - stopping pagination`,
          );
          break;
        }

        const stats = await this.upsertPage(
          items,
          runStartedAt,
          brandCache,
          categoryCache,
        );

        totalFetched += items.length;
        created += stats.created;
        updated += stats.updated;
        unchanged += stats.unchanged;

        this.logger.log(
          `Page ${page}/${lastPage}: ${items.length} items, ` +
            `created=${stats.created}, updated=${stats.updated}, unchanged=${stats.unchanged}`,
        );

        if (page < lastPage && delayMs > 0) {
          await this.sleep(delayMs);
        }
        page += 1;
      } while (page <= lastPage);

      if (deactivateMissing) {
        const result = await this.productRepo
          .createQueryBuilder()
          .update(Product)
          .set({ isActive: false })
          .where('synced_at IS NULL OR synced_at <> :runStartedAt', {
            runStartedAt,
          })
          .execute();

        this.logger.log(
          `Deactivated ${result.affected ?? 0} products not present in this run`,
        );
      }

      this.logger.log(
        `Finished product sync: fetched=${totalFetched}, created=${created}, ` +
          `updated=${updated}, unchanged=${unchanged}`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to sync products V2',
        (error as any)?.stack || String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async fetchPage(
    apiUrl: string,
    token: string | undefined,
    page: number,
    pageSize: number,
    maxRetries: number,
  ): Promise<ApiResponse> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const response$ = this.httpService.get<ApiResponse>(apiUrl, {
          params: { perpage: pageSize, page },
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            Accept: 'application/json',
          },
          timeout: 60_000,
        });

        const response = await lastValueFrom(response$);
        const body = response.data;

        if (!body?.status || !body.data || !Array.isArray(body.data.items)) {
          throw new Error(
            `Unexpected response shape on page ${page}: ${body?.message || 'missing data.items'}`,
          );
        }

        return body;
      } catch (error) {
        lastError = error;
        const status = (error as any)?.response?.status;
        const waitMs = status === 429 ? 30_000 : Math.min(5_000 * attempt, 30_000);

        this.logger.warn(
          `Fetch page ${page} failed (attempt ${attempt}/${maxRetries}, ` +
            `status=${status ?? 'n/a'}) - retrying in ${waitMs}ms`,
        );

        if (attempt < maxRetries) {
          await this.sleep(waitMs);
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to fetch page ${page}`);
  }

  private async upsertPage(
    items: ApiProduct[],
    runStartedAt: Date,
    brandCache: Map<string, Brand>,
    categoryCache: Map<string, Category>,
  ): Promise<PageStats> {
    const codes = Array.from(
      new Set(
        items
          .map((item) => item.MaHH?.trim())
          .filter((code): code is string => Boolean(code)),
      ),
    );

    if (codes.length === 0) {
      return { created: 0, updated: 0, unchanged: 0 };
    }

    const existingRows = await this.productRepo.find({
      where: { productCode: In(codes) },
      relations: ['brand', 'category'],
    });

    const existingByCode = new Map<string, Product[]>();
    for (const row of existingRows) {
      const rows = existingByCode.get(row.productCode) ?? [];
      rows.push(row);
      existingByCode.set(row.productCode, rows);
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const toSave: Product[] = [];

    for (const item of items) {
      const code = item.MaHH?.trim();
      if (!code) {
        continue;
      }

      const name = item.Name?.trim() || 'Unknown Product';
      const description = item.Description ? String(item.Description) : undefined;
      const rawPrice = this.toNullableNumber(item.Price);
      const price = rawPrice !== null && rawPrice > 0 ? rawPrice : null;
      const stock = this.toStockQty(item);
      const isInStock = this.toBoolean(item.Stock);

      const brand = item.Brand
        ? await this.getOrCreateBrand(String(item.Brand).trim(), brandCache)
        : undefined;
      const category = item.ProductGroup
        ? await this.getOrCreateCategory(
            String(item.ProductGroup).trim(),
            categoryCache,
          )
        : undefined;

      const rows = existingByCode.get(code);

      if (!rows || rows.length === 0) {
        const product = this.productRepo.create({
          productCode: code,
          productName: name,
          description,
          price,
          stock,
          isInStock,
          syncedAt: runStartedAt,
          isActive: true,
          brand,
          category,
        });
        toSave.push(product);
        created += 1;
        continue;
      }

      let businessChanged = false;
      for (const product of rows) {
        if (product.productName !== name) {
          product.productName = name;
          businessChanged = true;
        }

        if (description !== undefined && product.description !== description) {
          product.description = description;
          businessChanged = true;
        }

        if (product.price !== price) {
          product.price = price;
          businessChanged = true;
        }

        if (product.stock !== stock) {
          product.stock = stock;
          businessChanged = true;
        }

        if (product.isInStock !== isInStock) {
          product.isInStock = isInStock;
          businessChanged = true;
        }

        if (!product.isActive) {
          product.isActive = true;
          businessChanged = true;
        }

        if (brand && product.brand?.id !== brand.id) {
          product.brand = brand;
          businessChanged = true;
        }

        if (category && product.category?.id !== category.id) {
          product.category = category;
          businessChanged = true;
        }

        product.syncedAt = runStartedAt;
      }

      if (businessChanged) {
        toSave.push(...rows);
        updated += rows.length;
      } else {
        unchanged += rows.length;
      }
    }

    if (toSave.length > 0) {
      await this.productRepo.save(toSave, { chunk: 200 });
    }

    // Mark every product seen in this run, including rows whose business
    // fields did not change, so a later cleanup can distinguish stale rows.
    await this.productRepo
      .createQueryBuilder()
      .update(Product)
      .set({ syncedAt: runStartedAt })
      .where('product_code IN (:...codes)', { codes })
      .execute();

    return { created, updated, unchanged };
  }

  private async loadBrandCategoryCache(
    brandCache: Map<string, Brand>,
    categoryCache: Map<string, Category>,
  ): Promise<void> {
    const [brands, categories] = await Promise.all([
      this.brandRepo.find(),
      this.categoryRepo.find(),
    ]);

    for (const brand of brands) {
      brandCache.set(this.normalizeKey(brand.name), brand);
    }
    for (const category of categories) {
      categoryCache.set(this.normalizeKey(category.catName), category);
    }
  }

  private async getOrCreateBrand(
    name: string,
    cache: Map<string, Brand>,
  ): Promise<Brand | undefined> {
    if (!name) {
      return undefined;
    }

    const key = this.normalizeKey(name);
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const existing = await this.brandRepo.findOne({ where: { name } });
    if (existing) {
      cache.set(key, existing);
      return existing;
    }

    const slug = this.makeSlug(name);
    const brand = await this.brandRepo.save(
      this.brandRepo.create({
        name: name.slice(0, 255),
        slug,
      }),
    );
    cache.set(key, brand);

    await this.ensurePermission(`pm_brand_${slug}`);
    return brand;
  }

  private async getOrCreateCategory(
    name: string,
    cache: Map<string, Category>,
  ): Promise<Category | undefined> {
    if (!name) {
      return undefined;
    }

    const key = this.normalizeKey(name);
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const existing = await this.categoryRepo.findOne({
      where: { catName: name },
    });
    if (existing) {
      cache.set(key, existing);
      return existing;
    }

    const slug = this.makeSlug(name);
    const category = await this.categoryRepo.save(
      this.categoryRepo.create({
        catName: name.slice(0, 255),
        slug,
      }),
    );
    cache.set(key, category);

    await this.ensurePermission(`pm_cat_${slug}`);
    return category;
  }

  private async ensurePermission(name: string): Promise<void> {
    try {
      await this.permissionService.createPermission({
        name,
        action: 'scope',
      });
    } catch (error) {
      this.logger.debug(
        `Permission '${name}' already exists or could not be created: ${
          (error as any)?.message || error
        }`,
      );
    }
  }

  private normalizeKey(value: string): string {
    return value
      .replace(/[đĐ]/g, 'd')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private makeSlug(value: string): string {
    return slugify(value.replace(/[đĐ]/g, 'd'), {
      lower: true,
      strict: true,
    }).slice(0, 255);
  }

  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toStockQty(item: ApiProduct): number {
    const qty = this.toNullableNumber(item.SLCoTheXuat);
    if (qty !== null) {
      return Math.max(0, Math.trunc(qty));
    }
    return this.toBoolean(item.Stock) ? 1 : 0;
  }

  private toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
    }
    return false;
  }

  private getIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const parsed = raw !== undefined ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed >= 0
      ? Math.trunc(parsed)
      : fallback;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
