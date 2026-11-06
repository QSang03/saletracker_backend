import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Product } from '../products/product.entity';
import { ProductPriceHistory } from '../products/product-price-history.entity';
import { Brand } from '../brands/brand.entity';
import { Category } from '../categories/category.entity';
import { PermissionService } from '../permissions/permission.service';
import slugify from 'slugify';
import * as fs from 'fs';
import * as path from 'path';
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
  priceChanges: number;
  missingPrice: number;
  missingPriceItems: MissingPriceItem[];
}

/** Sản phẩm mà API không trả giá hợp lệ (Price thiếu/không phải số/âm). */
interface MissingPriceItem {
  page?: number;
  mahh: string;
  name: string;
  /** 'missing_or_invalid' = không có/không parse được; 'negative' = giá âm. */
  reason: 'missing_or_invalid' | 'negative';
  /** Giá trị thô của item.Price đúng như API trả về. */
  rawPrice: unknown;
  rawPriceType: string;
  /** Toàn bộ item thô để đối chiếu field bị đổi tên/thiếu. */
  rawItem: ApiProduct;
}

@Injectable()
export class ProductV2CronjobService {
  private readonly logger = new WinstonLogger(ProductV2CronjobService.name);
  private isRunning = false;
  /** Raw payload các sản phẩm API trả thiếu giá, giữ 3 ngày để đối chiếu. */
  private readonly missingPriceDumpDir = path.join(
    process.cwd(),
    'logs',
    'product-sync-missing-price',
  );
  private readonly missingPriceRetentionDays = 3;

  constructor(
    private readonly httpService: HttpService,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductPriceHistory)
    private readonly priceHistoryRepo: Repository<ProductPriceHistory>,
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
    let priceChanged = 0;
    // API trả thiếu/không hợp lệ giá — chỉ ghi log + dump raw, KHÔNG đổi logic
    // (giá vẫn được cập nhật về null như hiện tại).
    let missingPrice = 0;
    const missingPriceItems: MissingPriceItem[] = [];
    const maxMissingPriceDetails = this.getIntEnv(
      'PRODUCT_SYNC_MISSING_PRICE_MAX_DETAILS',
      2000,
    );

    this.logger.log(
      `Start product sync from: ${apiUrl} (pageSize=${pageSize})`,
    );

    try {
      const brandCache = new Map<string, Brand>();
      const categoryCache = new Map<string, Category>();
      await this.loadBrandCategoryCache(brandCache, categoryCache);
      this.cleanupMissingPriceDumps();

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
        priceChanged += stats.priceChanges;

        missingPrice += stats.missingPrice;
        if (stats.missingPrice > 0) {
          this.logger.warn(
            `Page ${page}: ${stats.missingPrice} sản phẩm API trả thiếu/không hợp lệ giá ` +
              `(vd: ${stats.missingPriceItems
                .slice(0, 5)
                .map((it) => `${it.mahh}=${JSON.stringify(it.rawPrice)}`)
                .join(', ')})`,
          );
          for (const item of stats.missingPriceItems) {
            if (missingPriceItems.length >= maxMissingPriceDetails) break;
            missingPriceItems.push({ ...item, page });
          }
        }

        this.logger.log(
          `Page ${page}/${lastPage}: ${items.length} items, ` +
            `created=${stats.created}, updated=${stats.updated}, unchanged=${stats.unchanged}, ` +
            `priceChanged=${stats.priceChanges}`,
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

      if (missingPrice > 0) {
        const dumpPath = this.writeMissingPriceDump(
          runStartedAt,
          apiUrl,
          missingPrice,
          missingPriceItems,
        );
        this.logger.warn(
          `Tổng ${missingPrice} sản phẩm API trả thiếu/không hợp lệ giá ` +
            `(chi tiết=${missingPriceItems.length}). ` +
            `Raw payload giữ ${this.missingPriceRetentionDays} ngày: ${dumpPath}`,
        );
      }

      this.logger.log(
        `Finished product sync: fetched=${totalFetched}, created=${created}, ` +
          `updated=${updated}, unchanged=${unchanged}, priceChanged=${priceChanged}, ` +
          `missingPrice=${missingPrice}`,
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
      return {
        created: 0,
        updated: 0,
        unchanged: 0,
        priceChanges: 0,
        missingPrice: 0,
        missingPriceItems: [],
      };
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
    // Giá đổi trong lần chạy này — ghi lịch sử sau khi upsert xong.
    const priceChanges: ProductPriceHistory[] = [];
    // API trả thiếu/không hợp lệ giá trong page này — chỉ dùng để log/dump raw.
    const missingPriceItems: MissingPriceItem[] = [];

    for (const item of items) {
      const code = item.MaHH?.trim();
      if (!code) {
        continue;
      }

      const name = item.Name?.trim() || 'Unknown Product';
      const description = item.Description ? String(item.Description) : undefined;
      const rawPrice = this.toNullableNumber(item.Price);
      // Giá 0 là giá trị hợp lệ (ERP có thể tạm đặt 0 khi đang cập nhật giá),
      // chỉ thiếu/không parse được hoặc âm mới coi là không có giá.
      const price = rawPrice !== null && rawPrice >= 0 ? rawPrice : null;

      // Chỉ ghi nhận để debug; sản phẩm không có giá hợp lệ vẫn lưu null.
      if (price === null) {
        missingPriceItems.push({
          mahh: code,
          name,
          reason: rawPrice === null ? 'missing_or_invalid' : 'negative',
          rawPrice: item.Price ?? null,
          rawPriceType:
            item.Price === null || item.Price === undefined
              ? String(item.Price)
              : typeof item.Price,
          rawItem: item,
        });
      }
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
          const oldPrice = product.price ?? null;
          product.price = price;
          businessChanged = true;

          // null và 0 đều nghĩa là "chưa có giá" → không coi là biến động giá.
          const isRealPriceChange = !(
            (oldPrice === null || oldPrice === 0) &&
            (price === null || price === 0)
          );

          if (isRealPriceChange) {
            // Giữ giá cũ + mốc thời gian để FE sale thấy "giá đã biến động".
            product.previousPrice = oldPrice;
            product.priceChangedAt = runStartedAt;

            if (product.id) {
              priceChanges.push(
                this.priceHistoryRepo.create({
                  productId: product.id,
                  productCode: product.productCode,
                  oldPrice,
                  newPrice: price,
                  changedAt: runStartedAt,
                  source: 'sync',
                }),
              );
            }
          }
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

    if (priceChanges.length > 0) {
      await this.priceHistoryRepo.save(priceChanges, { chunk: 200 });
    }

    // Mark every product seen in this run, including rows whose business
    // fields did not change, so a later cleanup can distinguish stale rows.
    await this.productRepo
      .createQueryBuilder()
      .update(Product)
      .set({ syncedAt: runStartedAt })
      .where('product_code IN (:...codes)', { codes })
      .execute();

    return {
      created,
      updated,
      unchanged,
      priceChanges: priceChanges.length,
      missingPrice: missingPriceItems.length,
      missingPriceItems,
    };
  }

  /**
   * Ghi raw payload các sản phẩm API trả thiếu/không hợp lệ giá.
   * Mỗi lần sync 1 file JSON; file cũ hơn missingPriceRetentionDays bị xoá.
   */
  private writeMissingPriceDump(
    runStartedAt: Date,
    apiUrl: string,
    totalMissing: number,
    items: MissingPriceItem[],
  ): string {
    const filePath = path.join(
      this.missingPriceDumpDir,
      `${this.formatDumpTimestamp(runStartedAt)}.json`,
    );
    try {
      fs.mkdirSync(this.missingPriceDumpDir, { recursive: true });
      const payload = {
        runStartedAt: runStartedAt.toISOString(),
        apiUrl,
        totalMissing,
        detailCount: items.length,
        truncated: items.length < totalMissing,
        items: items.map((item) => ({
          page: item.page,
          MaHH: item.mahh,
          Name: item.name,
          reason: item.reason,
          rawPrice: item.rawPrice,
          rawPriceType: item.rawPriceType,
          rawItem: item.rawItem,
        })),
      };
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
      return filePath;
    } catch (error) {
      this.logger.error(
        `Không ghi được dump thiếu giá: ${(error as Error)?.message || error}`,
      );
      return '(không ghi được)';
    }
  }

  private cleanupMissingPriceDumps(): void {
    try {
      if (!fs.existsSync(this.missingPriceDumpDir)) return;
      const cutoff =
        Date.now() - this.missingPriceRetentionDays * 24 * 60 * 60 * 1000;
      let removed = 0;
      for (const name of fs.readdirSync(this.missingPriceDumpDir)) {
        if (!name.endsWith('.json')) continue;
        const full = path.join(this.missingPriceDumpDir, name);
        try {
          if (fs.statSync(full).mtimeMs < cutoff) {
            fs.unlinkSync(full);
            removed += 1;
          }
        } catch {
          // bỏ qua file đang bị khoá/không đọc được
        }
      }
      if (removed > 0) {
        this.logger.log(
          `Dọn ${removed} file dump thiếu giá cũ hơn ${this.missingPriceRetentionDays} ngày`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Không dọn được dump thiếu giá: ${(error as Error)?.message || error}`,
      );
    }
  }

  private formatDumpTimestamp(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
    );
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
