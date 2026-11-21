import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WinstonLogger } from '../../common/winston.logger';
import { Product } from '../../products/product.entity';
import { SaleBuild } from '../entities/sale-build.entity';
import { SaleBuildItem } from '../entities/sale-build-item.entity';
import { SaleQuickQuoteCase } from '../entities/sale-quick-quote-case.entity';
import { SaleQuickQuoteItem } from '../entities/sale-quick-quote-item.entity';
import { SaleQuote } from '../entities/sale-quote.entity';
import { SaleQuoteItem } from '../entities/sale-quote-item.entity';
import { SaleExcelItem } from '../entities/sale-excel-item.entity';
import { SalePricingService } from './sale-pricing.service';
import { SaleSettingsService } from './sale-settings.service';

function computeStockStatus(stock: number): string {
  if (stock > 10) return ';SẴN HÀNG';
  if (stock > 0) return ';GẦN HẾT HÀNG';
  return ';CHECK KHO CHỜ NHẬP';
}

function isStandardStatus(statusText?: string | null): boolean {
  const upper = (statusText || '').toUpperCase();
  return (
    !upper ||
    upper.includes('SẴN') ||
    upper.includes('GẦN HẾT') ||
    upper.includes('CHỜ') ||
    upper.includes('CHECK')
  );
}

@Injectable()
export class SaleDataSyncService {
  private readonly logger = new WinstonLogger(SaleDataSyncService.name);
  private isSyncing = false;

  constructor(
    @InjectRepository(SaleBuild)
    private readonly buildRepo: Repository<SaleBuild>,
    @InjectRepository(SaleBuildItem)
    private readonly buildItemRepo: Repository<SaleBuildItem>,
    @InjectRepository(SaleQuickQuoteCase)
    private readonly quickCaseRepo: Repository<SaleQuickQuoteCase>,
    @InjectRepository(SaleQuickQuoteItem)
    private readonly quickItemRepo: Repository<SaleQuickQuoteItem>,
    @InjectRepository(SaleQuote)
    private readonly quoteRepo: Repository<SaleQuote>,
    @InjectRepository(SaleQuoteItem)
    private readonly quoteItemRepo: Repository<SaleQuoteItem>,
    @InjectRepository(SaleExcelItem)
    private readonly excelItemRepo: Repository<SaleExcelItem>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly pricingService: SalePricingService,
    private readonly settingsService: SaleSettingsService,
  ) {}

  /**
   * Kích hoạt quét đồng bộ dữ liệu S1 cho toàn bộ Báo giá, Cấu hình máy ráp, Quick Case & Bảng giá Excel phân tầng
   * Chạy tự động sau khi S1 sync hoàn tất, chia theo từng Batch để tối ưu hiệu năng.
   */
  async syncAllSaleDataFromS1(batchSize = 50): Promise<{
    success: boolean;
    message: string;
    stats?: any;
  }> {
    if (this.isSyncing) {
      this.logger.warn('SaleDataSync is already in progress. Skipping trigger.');
      return { success: false, message: 'Sync already in progress' };
    }

    this.isSyncing = true;
    const startTime = Date.now();
    this.logger.log('>>> [SaleDataSync] Bắt đầu đồng bộ Đơn giá, Tồn kho & Tình trạng từ S1 (Batch Size: ' + batchSize + ')...');

    try {
      // 1. Đồng bộ Cấu hình máy ráp (SaleBuild)
      const buildStats = await this.syncBuildsBatch(batchSize);

      // 2. Đồng bộ Báo giá theo yêu cầu (SaleQuickQuoteCase)
      const caseStats = await this.syncQuickCasesBatch(batchSize);

      // 3. Đồng bộ Báo giá thông thường (SaleQuote)
      const quoteStats = await this.syncQuotesBatch(batchSize);

      // 4. Đồng bộ Bảng giá Excel Phân Tầng (SaleExcelItem) - KHÔNG ĐỔI GIÁ, CHỈ ĐỔI TỒN KHO & TÌNH TRẠNG KHO
      const excelStats = await this.syncExcelItemsBatch(100);

      const elapsedMs = Date.now() - startTime;
      const stats = { buildStats, caseStats, quoteStats, excelStats, elapsedMs };

      this.logger.log(
        `>>> [SaleDataSync] Hoàn tất đồng bộ S1 trong ${elapsedMs}ms! ` +
        `Cấu hình máy ráp: ${buildStats.updatedBuilds}/${buildStats.totalBuilds} (${buildStats.updatedItems} items), ` +
        `Báo giá theo yêu cầu: ${caseStats.updatedCases}/${caseStats.totalCases} (${caseStats.updatedItems} items), ` +
        `Báo giá thông thường: ${quoteStats.updatedQuotes}/${quoteStats.totalQuotes} (${quoteStats.updatedItems} items), ` +
        `Bảng giá Excel phân tầng: ${excelStats.updatedItems}/${excelStats.totalMatched} items`
      );

      return {
        success: true,
        message: 'Hoàn tất đồng bộ toàn bộ báo giá và cấu hình theo S1',
        stats,
      };
    } catch (error: any) {
      this.logger.error('Lỗi khi đồng bộ dữ liệu S1 cho báo giá/cấu hình:', error?.stack || String(error));
      return {
        success: false,
        message: 'Lỗi trong quá trình đồng bộ: ' + (error?.message || String(error)),
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Đồng bộ toàn bộ Cấu hình máy ráp (SaleBuild) theo từng Batch
   */
  private async syncBuildsBatch(batchSize: number) {
    let offset = 0;
    let totalBuilds = 0;
    let updatedBuilds = 0;
    let updatedItems = 0;

    const defaultRules = await this.settingsService.getEffectiveRules(1).catch(() => ({}));

    while (true) {
      const builds = await this.buildRepo.find({
        relations: ['items'],
        order: { id: 'ASC' },
        skip: offset,
        take: batchSize,
      });

      if (!builds || builds.length === 0) break;
      totalBuilds += builds.length;

      // Gom toàn bộ product_id và product_code trong batch này
      const productIds = new Set<number>();
      const productCodes = new Set<string>();

      for (const b of builds) {
        for (const item of b.items || []) {
          if (item.productId) productIds.add(item.productId);
          if (item.productCode?.trim()) productCodes.add(item.productCode.trim());
          if (item.pn?.trim()) productCodes.add(item.pn.trim());
        }
      }

      const prodMap = await this.loadS1Products(
        Array.from(productIds),
        Array.from(productCodes),
      );

      const itemsToSave: SaleBuildItem[] = [];
      const buildsToUpdate: { id: number; totalAmount: number }[] = [];

      for (const build of builds) {
        let buildTotal = 0;
        let buildChanged = false;

        for (const item of build.items || []) {
          const prod = this.findProduct(prodMap, item.productId, item.productCode, item.pn);
          if (prod) {
            const stock = prod.stock !== null && prod.stock !== undefined ? Math.max(0, Number(prod.stock)) : 0;
            const s1Price = Number(prod.price) || 0;
            let changed = false;

            // 1. Cập nhật giá vốn
            if (s1Price > 0 && s1Price !== item.costPrice) {
              item.costPrice = s1Price;
              changed = true;
            }

            // 2. Cập nhật đơn giá bán
            if (s1Price > 0) {
              const wasEqualCost = !item.salePrice || item.salePrice === item.costPrice;
              let newSalePrice = item.salePrice;
              if (wasEqualCost) {
                newSalePrice = s1Price;
              } else {
                const suggested = this.pricingService.suggestSalePrice(s1Price, defaultRules);
                newSalePrice = suggested || s1Price;
              }
              if (newSalePrice !== item.salePrice) {
                item.salePrice = newSalePrice;
                changed = true;
              }
            }

            // 3. Cập nhật thành tiền
            const qty = Math.max(1, Number(item.quantity) || 1);
            const lineTotal = item.salePrice ? item.salePrice * qty : null;
            if (lineTotal !== item.lineTotal) {
              item.lineTotal = lineTotal;
              changed = true;
            }

            // 4. Cập nhật tình trạng kho
            if (isStandardStatus(item.statusText)) {
              const newStatus = computeStockStatus(stock);
              if (newStatus !== item.statusText) {
                item.statusText = newStatus;
                changed = true;
              }
            }

            // 5. Cập nhật metadata stock
            const curMetaStock = item.metadata?.stock;
            if (curMetaStock !== stock) {
              item.metadata = { ...(item.metadata || {}), stock };
              changed = true;
            }

            if (changed) {
              itemsToSave.push(item);
              buildChanged = true;
            }
          }

          buildTotal += (item.lineTotal || 0);
        }

        if (buildTotal !== build.totalAmount || buildChanged) {
          buildsToUpdate.push({ id: build.id, totalAmount: buildTotal });
          updatedBuilds++;
        }
      }

      if (itemsToSave.length > 0) {
        await this.buildItemRepo.save(itemsToSave);
        updatedItems += itemsToSave.length;
      }
      for (const b of buildsToUpdate) {
        await this.buildRepo.update(b.id, { totalAmount: b.totalAmount });
      }

      offset += batchSize;
      await this.sleep(20);
    }

    return { totalBuilds, updatedBuilds, updatedItems };
  }

  /**
   * Đồng bộ toàn bộ Báo giá theo yêu cầu (SaleQuickQuoteCase) theo từng Batch
   */
  private async syncQuickCasesBatch(batchSize: number) {
    let offset = 0;
    let totalCases = 0;
    let updatedCases = 0;
    let updatedItems = 0;

    const defaultRules = await this.settingsService.getEffectiveRules(1).catch(() => ({}));

    while (true) {
      const cases = await this.quickCaseRepo.find({
        relations: ['items'],
        order: { id: 'ASC' },
        skip: offset,
        take: batchSize,
      });

      if (!cases || cases.length === 0) break;
      totalCases += cases.length;

      const productIds = new Set<number>();
      const productCodes = new Set<string>();

      for (const c of cases) {
        for (const item of c.items || []) {
          if (item.productId) productIds.add(item.productId);
          if (item.productCode?.trim()) productCodes.add(item.productCode.trim());
          if (item.pn?.trim()) productCodes.add(item.pn.trim());
        }
      }

      const prodMap = await this.loadS1Products(
        Array.from(productIds),
        Array.from(productCodes),
      );

      const itemsToSave: SaleQuickQuoteItem[] = [];
      const casesToUpdate: { id: number; totalAmount: number }[] = [];

      for (const quickCase of cases) {
        let caseTotal = 0;
        let caseChanged = false;

        for (const item of quickCase.items || []) {
          const prod = this.findProduct(prodMap, item.productId, item.productCode, item.pn);
          if (prod) {
            const stock = prod.stock !== null && prod.stock !== undefined ? Math.max(0, Number(prod.stock)) : 0;
            const s1Price = Number(prod.price) || 0;
            let changed = false;

            // 1. Cập nhật giá vốn
            if (s1Price > 0 && s1Price !== item.costPrice) {
              item.costPrice = s1Price;
              changed = true;
            }

            // 2. Cập nhật giá bán
            if (s1Price > 0) {
              const wasEqualCost = !item.salePrice || item.salePrice === item.costPrice;
              let newSalePrice = item.salePrice;
              if (wasEqualCost) {
                newSalePrice = s1Price;
              } else {
                const suggested = this.pricingService.suggestSalePrice(s1Price, defaultRules);
                newSalePrice = suggested || s1Price;
              }
              if (newSalePrice !== item.salePrice) {
                item.salePrice = newSalePrice;
                changed = true;
              }
            }

            // 3. Cập nhật thành tiền
            const qty = Math.max(1, Number(item.quantity) || 1);
            const lineTotal = item.salePrice ? item.salePrice * qty : null;
            if (lineTotal !== item.lineTotal) {
              item.lineTotal = lineTotal;
              changed = true;
            }

            // 4. Cập nhật tình trạng kho
            if (isStandardStatus(item.statusText)) {
              const newStatus = computeStockStatus(stock);
              if (newStatus !== item.statusText) {
                item.statusText = newStatus;
                changed = true;
              }
            }

            if (changed) {
              itemsToSave.push(item);
              caseChanged = true;
            }
          }

          caseTotal += (item.lineTotal || 0);
        }

        if (caseTotal !== quickCase.totalAmount || caseChanged) {
          casesToUpdate.push({ id: quickCase.id, totalAmount: caseTotal });
          updatedCases++;
        }
      }

      if (itemsToSave.length > 0) {
        await this.quickItemRepo.save(itemsToSave);
        updatedItems += itemsToSave.length;
      }
      for (const c of casesToUpdate) {
        await this.quickCaseRepo.update(c.id, { totalAmount: c.totalAmount });
      }

      offset += batchSize;
      await this.sleep(20);
    }

    return { totalCases, updatedCases, updatedItems };
  }

  /**
   * Đồng bộ toàn bộ Báo giá thông thường (SaleQuote) theo từng Batch
   */
  private async syncQuotesBatch(batchSize: number) {
    let offset = 0;
    let totalQuotes = 0;
    let updatedQuotes = 0;
    let updatedItems = 0;

    const defaultRules = await this.settingsService.getEffectiveRules(1).catch(() => ({}));

    while (true) {
      const quotes = await this.quoteRepo.find({
        relations: ['items'],
        order: { id: 'ASC' },
        skip: offset,
        take: batchSize,
      });

      if (!quotes || quotes.length === 0) break;
      totalQuotes += quotes.length;

      const productIds = new Set<number>();
      const productCodes = new Set<string>();

      for (const q of quotes) {
        for (const item of q.items || []) {
          if (item.productId) productIds.add(item.productId);
          if (item.productCode?.trim()) productCodes.add(item.productCode.trim());
          if (item.pn?.trim()) productCodes.add(item.pn.trim());
        }
      }

      const prodMap = await this.loadS1Products(
        Array.from(productIds),
        Array.from(productCodes),
      );

      const itemsToSave: SaleQuoteItem[] = [];
      const quotesToUpdate: { id: number; totalAmount: number }[] = [];

      for (const quote of quotes) {
        let quoteTotal = 0;
        let quoteChanged = false;

        for (const item of quote.items || []) {
          const prod = this.findProduct(prodMap, item.productId, item.productCode, item.pn);
          if (prod) {
            const stock = prod.stock !== null && prod.stock !== undefined ? Math.max(0, Number(prod.stock)) : 0;
            const s1Price = Number(prod.price) || 0;
            let changed = false;

            // 1. Cập nhật giá vốn
            if (s1Price > 0 && s1Price !== item.costPrice) {
              item.costPrice = s1Price;
              changed = true;
            }

            // 2. Cập nhật đơn giá bán (unitPrice trong SaleQuoteItem)
            if (s1Price > 0) {
              const wasEqualCost = !item.unitPrice || item.unitPrice === item.costPrice;
              let newUnitPrice = item.unitPrice;
              if (wasEqualCost) {
                newUnitPrice = s1Price;
              } else {
                const suggested = this.pricingService.suggestSalePrice(s1Price, defaultRules);
                newUnitPrice = suggested || s1Price;
              }
              if (newUnitPrice !== item.unitPrice) {
                item.unitPrice = newUnitPrice;
                changed = true;
              }
            }

            // 3. Cập nhật thành tiền
            const qty = Math.max(1, Number(item.quantity) || 1);
            const lineTotal = item.unitPrice ? item.unitPrice * qty : null;
            if (lineTotal !== item.lineTotal) {
              item.lineTotal = lineTotal;
              changed = true;
            }

            // 4. Cập nhật tình trạng kho
            if (isStandardStatus(item.statusText)) {
              const newStatus = computeStockStatus(stock);
              if (newStatus !== item.statusText) {
                item.statusText = newStatus;
                changed = true;
              }
            }

            // 5. Cập nhật metadata stock
            const curMetaStock = item.metadata?.stock;
            if (curMetaStock !== stock) {
              item.metadata = { ...(item.metadata || {}), stock };
              changed = true;
            }

            if (changed) {
              itemsToSave.push(item);
              quoteChanged = true;
            }
          }

          quoteTotal += (item.lineTotal || 0);
        }

        if (quoteTotal !== quote.totalAmount || quoteChanged) {
          quotesToUpdate.push({ id: quote.id, totalAmount: quoteTotal });
          updatedQuotes++;
        }
      }

      if (itemsToSave.length > 0) {
        await this.quoteItemRepo.save(itemsToSave);
        updatedItems += itemsToSave.length;
      }
      for (const q of quotesToUpdate) {
        await this.quoteRepo.update(q.id, { totalAmount: q.totalAmount });
      }

      offset += batchSize;
      await this.sleep(20);
    }

    return { totalQuotes, updatedQuotes, updatedItems };
  }

  /**
   * Đồng bộ số lượng tồn kho và tình trạng kho cho các sản phẩm trong Bảng Giá Excel Phân Tầng
   * LƯU Ý BẤT BIẾN: TUYỆT ĐỐI KHÔNG CHỈNH ĐƠN GIÁ (item.price), CHỈ CẬP NHẬT TỒN KHO VÀ TÌNH TRẠNG KHO.
   */
  async syncExcelItemsBatch(batchSize = 200): Promise<{
    totalMatched: number;
    updatedItems: number;
  }> {
    let offset = 0;
    let totalMatched = 0;
    let updatedItems = 0;

    while (true) {
      // Quét các sản phẩm có khớp S1 (s1Matched = true hoặc s1ProductId != null)
      // CHỈ SELECT CÁC CỘT CẦN DÙNG, TUYỆT ĐỐI KHÔNG LOAD rawData (JSON lớn) để tránh ngốn RAM
      const excelItems = await this.excelItemRepo.find({
        select: [
          'id',
          'productCode',
          's1ProductId',
          's1StockQuantity',
          's1Matched',
          'isCustom',
          'rawStatus',
        ],
        where: [
          { s1Matched: true },
          { isCustom: false },
        ],
        order: { id: 'ASC' },
        skip: offset,
        take: batchSize,
      });

      if (!excelItems || excelItems.length === 0) break;
      totalMatched += excelItems.length;

      const productIds = new Set<number>();
      const productCodes = new Set<string>();

      for (const item of excelItems) {
        if (item.s1ProductId) productIds.add(item.s1ProductId);
        if (item.productCode?.trim()) productCodes.add(item.productCode.trim());
      }

      const prodMap = await this.loadS1Products(
        Array.from(productIds),
        Array.from(productCodes),
      );

      for (const item of excelItems) {
        const prod = this.findProduct(prodMap, item.s1ProductId, item.productCode);
        if (prod) {
          const stock = prod.stock !== null && prod.stock !== undefined ? Math.max(0, Number(prod.stock)) : 0;
          // 2. Cập nhật tình trạng kho:
          // Nếu tồn > 0: "SẴN HÀNG"
          // Nếu tồn = 0: "TẠM HẾT HÀNG"
          const newStatus = stock > 0 ? 'SẴN HÀNG' : 'TẠM HẾT HÀNG';
          const targetS1ProductId = prod.id || item.s1ProductId || null;

          const needUpdate =
            item.s1StockQuantity !== stock ||
            item.rawStatus !== newStatus ||
            !item.s1Matched ||
            item.isCustom !== false ||
            (!item.s1ProductId && Boolean(prod.id));

          if (needUpdate) {
            // Cập nhật trực tiếp bằng update theo id:
            // 1. Nhẹ RAM, không phải giữ mảng entities lớn trong bộ nhớ.
            // 2. An toàn tuyệt đối: MySQL chỉ cập nhật các cột này, raw_data và giá price trong DB được giữ nguyên vẹn 100%.
            await this.excelItemRepo.update(item.id, {
              s1StockQuantity: stock,
              rawStatus: newStatus,
              s1Matched: true,
              isCustom: false,
              s1ProductId: targetS1ProductId,
            });
            updatedItems++;
          }
        }
      }

      offset += batchSize;
      await this.sleep(20);
    }

    this.logger.log(
      `>>> [SaleDataSync] Đồng bộ Bảng Giá Excel: Đã quét ${totalMatched} sản phẩm khớp S1, cập nhật tồn/trạng thái cho ${updatedItems} sản phẩm (Giữ nguyên đơn giá).`
    );

    return { totalMatched, updatedItems };
  }

  /**
   * Tra cứu sản phẩm S1 theo batch
   */
  private async loadS1Products(
    productIds: number[],
    productCodes: string[],
  ): Promise<{
    byId: Map<number, Product>;
    byCode: Map<string, Product>;
  }> {
    const byId = new Map<number, Product>();
    const byCode = new Map<string, Product>();

    const conditions: any[] = [];
    if (productIds.length > 0) {
      conditions.push({ id: In(productIds) });
    }
    if (productCodes.length > 0) {
      conditions.push({ productCode: In(productCodes) });
    }

    if (conditions.length === 0) {
      return { byId, byCode };
    }

    const products = await this.productRepo.find({
      where: conditions,
      select: ['id', 'productCode', 'price', 'stock'],
    });

    for (const p of products) {
      if (p.id) byId.set(p.id, p);
      if (p.productCode) {
        byCode.set(p.productCode.trim().toLowerCase(), p);
      }
    }

    return { byId, byCode };
  }

  /**
   * Khớp sản phẩm S1 theo id hoặc code/pn
   */
  private findProduct(
    prodMap: { byId: Map<number, Product>; byCode: Map<string, Product> },
    productId?: number | null,
    productCode?: string | null,
    pn?: string | null,
  ): Product | undefined {
    if (productId && prodMap.byId.has(productId)) {
      return prodMap.byId.get(productId);
    }
    if (productCode && prodMap.byCode.has(productCode.trim().toLowerCase())) {
      return prodMap.byCode.get(productCode.trim().toLowerCase());
    }
    if (pn && prodMap.byCode.has(pn.trim().toLowerCase())) {
      return prodMap.byCode.get(pn.trim().toLowerCase());
    }
    return undefined;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
