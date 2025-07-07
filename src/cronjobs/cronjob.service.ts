import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NKCProduct } from '../nkc_products/nkc_product.entity';
import { Category } from '../categories/category.entity';

@Injectable()
export class CronjobService {
  private readonly logger = new Logger(CronjobService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectRepository(NKCProduct)
    private readonly nkcProductRepo: Repository<NKCProduct>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
  ) {}

  @Cron(process.env.CRON_PRODUCT_TIME || '0 2 * * *')
  async fetchAndSaveProducts() {
    const baseUrl = process.env.VNK_API_PRODUCT_URL!;
    const perPage = Number(process.env.VNK_API_PRODUCT_PER_PAGE) || 500;
    const token = this.configService.get<string>('VNK_API_TOKEN')!;
    const concurrency = 5;

    this.logger.log(`[ProductSync] Start product sync...`);

    // Lấy sản phẩm từ API
    let allProducts: any[] = [];
    let apiIds = new Set<number>();
    let page = 1;
    let done = false;
    while (!done) {
      const pages = Array.from({ length: concurrency }, (_, idx) => page + idx);
      const results = await Promise.all(
        pages.map((p) => this.fetchPage(baseUrl, token, perPage, p)),
      );
      for (const [idx, products] of results.entries()) {
        if (!products.length) {
          done = true;
          break;
        }
        allProducts.push(...products);
        products.forEach((item) => apiIds.add(item.product_id));
      }
      page += concurrency;
    }
    this.logger.log(`[ProductSync] Fetched ${allProducts.length} products.`);

    // Upsert sản phẩm mới/cập nhật
    const upsertBatch = allProducts.map((item) => ({
      id: item.product_id,
      productCode: item.MaHH,
      productName: item.TenHH,
      properties: item.properties,
      deletedAt: undefined,
    }));
    await this.nkcProductRepo.upsert(upsertBatch, ['id']);
    this.logger.log(`[ProductSync] Upserted ${upsertBatch.length} products.`);

    // XÓA MỀM: Đánh dấu deletedAt cho sản phẩm không còn trong API
    const deleteBatchSize = 1000;
    let dbOffset = 0;
    let hasMore = true;
    let deletedCount = 0;
    while (hasMore) {
      const dbProducts = await this.nkcProductRepo.find({
        select: ['id'],
        skip: dbOffset,
        take: deleteBatchSize,
      });
      if (!dbProducts.length) break;
      for (const dbProduct of dbProducts) {
        if (!apiIds.has(dbProduct.id)) {
          await this.nkcProductRepo.update(dbProduct.id, {
            deletedAt: new Date(),
          });
          deletedCount++;
        }
      }
      dbOffset += deleteBatchSize;
      hasMore = dbProducts.length === deleteBatchSize;
    }
    this.logger.log(
      `[ProductSync] Soft-deleted ${deletedCount} products not found in API.`,
    );
    this.logger.log(`[ProductSync] Product sync completed.`);
  }

  // Hàm lấy 1 trang sản phẩm
  private async fetchPage(
    baseUrl: string,
    token: string,
    perPage: number,
    page: number,
  ) {
    const url = `${baseUrl}?search=&per_page=${perPage}&page=${page}`;
    try {
      const res = await firstValueFrom(
        this.httpService.get(url, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      return res.data?.data?.data || [];
    } catch (error) {
      this.logger.error(
        `[ProductSync] Error fetching page ${page}: ${error.message}`,
      );
      return [];
    }
  }

  @Cron(process.env.CRON_CATEGORY_TIME || '0 3 * * *') // thời gian lấy từ env
  async fetchAndSaveCategories() {
    const url = this.configService.get<string>('VNK_API_CATEGORY_URL')!;
    const token = this.configService.get<string>('VNK_API_TOKEN')!;
    const response = await firstValueFrom(
      this.httpService.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    const categories: any[] = response.data?.data || [];
    type FlatCategory = { id: number; catName: string; parent: number | null };
    const flatCategories: FlatCategory[] = [];
    function flatten(cat: any, parentId: number | null = null) {
      flatCategories.push({
        id: cat.cat_id,
        catName: cat.cat_name,
        parent: parentId,
      });
      if (cat.children && Array.isArray(cat.children)) {
        for (const child of cat.children) {
          flatten(child, cat.cat_id);
        }
      }
    }
    for (const cat of categories) {
      flatten(cat, null);
    }
    const apiIds = flatCategories.map((c) => c.id);
    for (const cat of flatCategories) {
      await this.categoryRepo.upsert(
        {
          id: cat.id,
          catName: cat.catName,
          deletedAt: undefined,
          parent: cat.parent ? { id: cat.parent } : undefined,
        },
        ['id'],
      );
    }
    // Batch check for deleted
    const batchSize = 1000;
    let deletedCatCount = 0;
    let dbOffset = 0;
    let hasMore = true;
    while (hasMore) {
      const dbCats = await this.categoryRepo.find({
        select: ['id'],
        skip: dbOffset,
        take: batchSize,
      });
      if (!dbCats.length) break;
      for (const dbCat of dbCats) {
        if (!apiIds.includes(dbCat.id)) {
          await this.categoryRepo.update(dbCat.id, { deletedAt: new Date() });
          deletedCatCount++;
        }
      }
      dbOffset += batchSize;
      hasMore = dbCats.length === batchSize;
    }
    this.logger.log(
      `Hoàn tất đồng bộ danh mục. Đã lưu ${flatCategories.length} danh mục, đánh dấu xóa ${deletedCatCount} danh mục không còn trong API.`,
    );
  }
}
