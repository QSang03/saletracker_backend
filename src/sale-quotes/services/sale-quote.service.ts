import { PricingRules } from '../sale-quote.constants';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Product } from '../../products/product.entity';
import { SaleExcelItem } from '../entities/sale-excel-item.entity';
import { SaleQuote } from '../entities/sale-quote.entity';
import { SaleQuoteItem } from '../entities/sale-quote-item.entity';
import {
  CreateQuoteDto,
  QuoteItemInputDto,
  QueryQuoteDto,
  UpdateQuoteDto,
  UpdateQuoteItemDto,
} from '../dto/quote.dto';
import { SaleSettingsService } from './sale-settings.service';
import { SalePricingService } from './sale-pricing.service';
import { SaleTextRendererService } from './sale-text-renderer.service';
import { AuthenticatedUser } from '../types/auth-user.type';
import {
  assertCanMutate,
  assertOwnerOrAdmin,
  canReadAll,
  getUserId,
} from '../utils/entity-access.util';
import {
  computeStockStatus,
  normalizeStatusText,
  productWarrantyText,
  sumLineTotals,
} from '../utils/text.util';

@Injectable()
export class SaleQuoteService {
  constructor(
    @InjectRepository(SaleQuote)
    private readonly quoteRepo: Repository<SaleQuote>,
    @InjectRepository(SaleQuoteItem)
    private readonly itemRepo: Repository<SaleQuoteItem>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(SaleExcelItem)
    private readonly excelItemRepo: Repository<SaleExcelItem>,
    private readonly dataSource: DataSource,
    private readonly settingsService: SaleSettingsService,
    private readonly pricingService: SalePricingService,
    private readonly renderer: SaleTextRendererService,
  ) {}

  async create(dto: CreateQuoteDto, user: AuthenticatedUser) {
    assertCanMutate(user);
    const userId = getUserId(user);
    const settings = await this.settingsService.getForUser(userId);
    const rules = await this.settingsService.getEffectiveRules(userId);
    const itemDtos = dto.items || [];
    const products = await this.loadProducts(
      itemDtos.map((item) => item.productId).filter(Boolean) as number[],
    );

    const quote = this.quoteRepo.create({
      quoteCode: await this.generateQuoteCode(),
      title: dto.title?.trim() || null,
      customerName: dto.customerName?.trim() || null,
      customerPhone: dto.customerPhone?.trim() || null,
      customerAddress: dto.customerAddress?.trim() || null,
      saleUserId: userId,
      status: dto.status || 'draft',
      mode: dto.mode || 'standard',
      globalNote:
        dto.globalNote?.trim() || settings.defaultGlobalNote?.trim() || null,
      zaloSuffix:
        dto.zaloSuffix?.trim() || settings.zaloSuffix?.trim() || null,
      metadata: dto.metadata ?? null,
      sentAt: dto.status === 'sent' ? new Date() : null,
    });
    const saved = await this.quoteRepo.save(quote);

    const items = itemDtos.map((itemDto, index) =>
      this.buildItemEntity(
        saved.id,
        itemDto,
        index,
        settings,
        rules,
        products,
      ),
    );
    if (items.length > 0) {
      await this.itemRepo.save(items);
    }
    await this.recalculateTotals(saved.id);
    return this.findOne(saved.id, user);
  }

  async findAll(query: QueryQuoteDto, user: AuthenticatedUser) {
    const userId = getUserId(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Math.min(Number(query.pageSize) || 20, 100));

    const qb = this.quoteRepo
      .createQueryBuilder('q')
      .leftJoinAndSelect('q.saleUser', 'u')
      .loadRelationCountAndMap('q.itemCount', 'q.items')
      .orderBy('q.createdAt', 'DESC')
      .addOrderBy('q.id', 'DESC');

    const readAll = canReadAll(user);
    if (query.mine || !readAll) {
      qb.andWhere('q.sale_user_id = :userId', { userId });
    } else if (query.saleUserId) {
      qb.andWhere('q.sale_user_id = :saleUserId', {
        saleUserId: query.saleUserId,
      });
    }

    if (query.status) {
      qb.andWhere('q.status = :status', { status: query.status });
    }
    if (query.mode) {
      qb.andWhere('q.mode = :mode', { mode: query.mode });
    }
    if (query.search?.trim()) {
      const keyword = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        `(LOWER(q.quote_code) LIKE :keyword
          OR LOWER(q.title) LIKE :keyword
          OR LOWER(q.customer_name) LIKE :keyword
          OR LOWER(q.customer_phone) LIKE :keyword)`,
        { keyword },
      );
    }
    if (query.dateFrom) {
      qb.andWhere('q.created_at >= :dateFrom', {
        dateFrom: new Date(query.dateFrom),
      });
    }
    if (query.dateTo) {
      qb.andWhere('q.created_at <= :dateTo', {
        dateTo: new Date(query.dateTo),
      });
    }

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, pageSize };
  }

  async findOne(id: number, user: AuthenticatedUser) {
    const quote = await this.quoteRepo
      .createQueryBuilder('q')
      .leftJoinAndSelect('q.saleUser', 'u')
      .leftJoinAndSelect('q.items', 'i')
      .where('q.id = :id', { id })
      .orderBy('i.sortOrder', 'ASC')
      .addOrderBy('i.id', 'ASC')
      .getOne();

    if (!quote) {
      throw new NotFoundException('Báo giá không tồn tại');
    }
    this.assertCanRead(quote, user);

    const userId = getUserId(user);
    const rules = await this.settingsService.getEffectiveRules(userId);
    const productMap = await this.loadProductsForItems(quote.items || []);

    const itemsToPersist: SaleQuoteItem[] = [];

    const updatedItems = (quote.items || []).map((item) => {
      const prod = productMap.get(item.productId, item.productCode);

      // 1. Tồn kho mới nhất
      const resolvedStock =
        prod?.stock !== null && prod?.stock !== undefined
          ? Number(prod.stock)
          : item.metadata?.stock !== undefined && item.metadata?.stock !== null
          ? Number(item.metadata.stock)
          : 0;

      // 2. Giá vốn mới nhất từ kho (ưu tiên giá kho mới cập nhật)
      let resolvedCostPrice = item.costPrice;
      if (prod?.costPrice !== null && prod?.costPrice !== undefined && Number(prod.costPrice) > 0) {
        resolvedCostPrice = Number(prod.costPrice);
      }

      // 3. Đơn giá bán mới nhất
      let resolvedUnitPrice = item.unitPrice;
      if (!item.isManual && resolvedCostPrice !== null && resolvedCostPrice !== undefined && Number(resolvedCostPrice) > 0) {
        const wasEqualCost = !item.unitPrice || item.unitPrice === item.costPrice;
        if (wasEqualCost) {
          resolvedUnitPrice = resolvedCostPrice;
        } else {
          const suggested = this.pricingService.suggestSalePrice(resolvedCostPrice, rules);
          resolvedUnitPrice = suggested || resolvedCostPrice;
        }
      }

      // 4. Thành tiền mới nhất
      const qty = Math.max(1, Number(item.quantity) || 1);
      const resolvedLineTotal =
        resolvedUnitPrice !== null && resolvedUnitPrice !== undefined
          ? resolvedUnitPrice * qty
          : null;

      // 5. Bảo hành
      const resolvedWarranty = item.warranty || prod?.warranty || null;

      // 6. Tự động đồng bộ tình trạng kho theo số lượng tồn kho mới nhất
      let resolvedStatusText = item.statusText;
      if (!item.isManual) {
        const upper = (item.statusText || '').toUpperCase();
        const isStandard =
          !upper ||
          upper.includes('SẴN') ||
          upper.includes('GẦN HẾT') ||
          upper.includes('CHỜ') ||
          upper.includes('CHECK');
        if (isStandard) {
          if (prod?.rawStatus && !prod.isS1 && resolvedStock === 0) {
            resolvedStatusText = prod.rawStatus;
          } else {
            resolvedStatusText = computeStockStatus(resolvedStock, item.statusText || undefined);
          }
        }
      }

      // 7. Auto-heal pn cho sản phẩm S1 nếu bị kẹt P/N của linh kiện cũ trước khi đổi
      let resolvedPn = item.pn;
      if (!item.isManual && (item.productId || prod)) {
        const effectiveCode = item.productCode || prod?.productCode;
        if (resolvedPn && effectiveCode && resolvedPn !== effectiveCode) {
          resolvedPn = effectiveCode;
        }
      }

      // Kiểm tra thay đổi để lưu ngầm
      const hasChanged =
        (resolvedCostPrice !== null && resolvedCostPrice !== item.costPrice) ||
        (resolvedUnitPrice !== null && resolvedUnitPrice !== item.unitPrice) ||
        (resolvedLineTotal !== null && resolvedLineTotal !== item.lineTotal) ||
        (resolvedStatusText && resolvedStatusText !== item.statusText);

      if (hasChanged && item.id) {
        item.costPrice = resolvedCostPrice;
        item.unitPrice = resolvedUnitPrice;
        item.lineTotal = resolvedLineTotal;
        item.statusText = resolvedStatusText;
        itemsToPersist.push(item);
      }

      return {
        ...item,
        pn: resolvedPn,
        stock: resolvedStock,
        costPrice: resolvedCostPrice,
        unitPrice: resolvedUnitPrice,
        lineTotal: resolvedLineTotal,
        warranty: resolvedWarranty,
        statusText: resolvedStatusText,
      };
    });

    if (itemsToPersist.length > 0) {
      this.itemRepo.save(itemsToPersist).then(() => {
        this.recalculateTotals(quote.id);
      }).catch((err) => {
        console.error('Lỗi khi lưu đồng bộ kho cho quote:', err);
      });
    }

    const calculatedTotal = updatedItems.reduce((sum, it) => sum + (it.lineTotal || 0), 0);

    return {
      ...quote,
      totalAmount: calculatedTotal > 0 ? calculatedTotal : quote.totalAmount,
      items: updatedItems,
    };
  }

  async update(id: number, dto: UpdateQuoteDto, user: AuthenticatedUser) {
    const quote = await this.getEditableQuote(id, user);

    if (dto.title !== undefined) quote.title = dto.title?.trim() || null;
    if (dto.customerName !== undefined) {
      quote.customerName = dto.customerName?.trim() || null;
    }
    if (dto.customerPhone !== undefined) {
      quote.customerPhone = dto.customerPhone?.trim() || null;
    }
    if (dto.customerAddress !== undefined) {
      quote.customerAddress = dto.customerAddress?.trim() || null;
    }
    if (dto.status !== undefined) {
      quote.status = dto.status;
      if (dto.status === 'sent' && !quote.sentAt) {
        quote.sentAt = new Date();
      }
    }
    if (dto.mode !== undefined) quote.mode = dto.mode;
    if (dto.globalNote !== undefined) {
      quote.globalNote = dto.globalNote?.trim() || null;
    }
    if (dto.zaloSuffix !== undefined) {
      quote.zaloSuffix = dto.zaloSuffix?.trim() || null;
    }
    if (dto.metadata !== undefined) quote.metadata = dto.metadata;

    await this.quoteRepo.save(quote);
    return this.findOne(id, user);
  }

  async remove(id: number, user: AuthenticatedUser) {
    const quote = await this.getEditableQuote(id, user);
    await this.quoteRepo.softRemove(quote);
    return { success: true };
  }

  async duplicate(id: number, user: AuthenticatedUser) {
    assertCanMutate(user);
    const source = await this.quoteRepo
      .createQueryBuilder('q')
      .leftJoinAndSelect('q.items', 'i')
      .where('q.id = :id', { id })
      .orderBy('i.sortOrder', 'ASC')
      .getOne();

    if (!source) {
      throw new NotFoundException('Báo giá không tồn tại');
    }
    this.assertCanRead(source, user);

    const saved = await this.quoteRepo.save(
      this.quoteRepo.create({
        quoteCode: await this.generateQuoteCode(),
        title: source.title ? `${source.title} (Bản sao)` : 'Bản sao',
        customerName: source.customerName,
        customerPhone: source.customerPhone,
        customerAddress: source.customerAddress,
        saleUserId: getUserId(user),
        status: 'draft',
        mode: source.mode,
        globalNote: source.globalNote,
        zaloSuffix: source.zaloSuffix,
        metadata: source.metadata,
      }),
    );

    const items = (source.items || []).map((item, index) =>
      this.itemRepo.create({
        quoteId: saved.id,
        productId: item.productId,
        productCode: item.productCode,
        pn: item.pn,
        name: item.name,
        description: item.description,
        warranty: item.warranty,
        costPrice: item.costPrice,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        statusText: item.statusText,
        note: item.note,
        sortOrder: index,
        isManual: item.isManual,
        metadata: item.metadata,
      }),
    );
    if (items.length > 0) {
      await this.itemRepo.save(items);
    }
    await this.recalculateTotals(saved.id);
    return this.findOne(saved.id, user);
  }

  async addItem(id: number, dto: QuoteItemInputDto, user: AuthenticatedUser) {
    const quote = await this.getEditableQuote(id, user);
    const userId = getUserId(user);
    const settings = await this.settingsService.getForUser(userId);
    const rules = await this.settingsService.getEffectiveRules(userId);
    const products = await this.loadProducts(
      dto.productId ? [dto.productId] : [],
    );

    const maxOrder = await this.itemRepo
      .createQueryBuilder('i')
      .select('MAX(i.sort_order)', 'max')
      .where('i.quote_id = :id', { id })
      .getRawOne<{ max: string | null }>();
    const nextOrder = Number(maxOrder?.max ?? -1) + 1;

    const entity = this.buildItemEntity(
      quote.id,
      dto,
      dto.sortOrder ?? nextOrder,
      settings,
      rules,
      products,
    );
    await this.itemRepo.save(entity);
    await this.recalculateTotals(quote.id);
    return this.findOne(quote.id, user);
  }

  async updateItem(
    id: number,
    itemId: number,
    dto: UpdateQuoteItemDto,
    user: AuthenticatedUser,
  ) {
    const quote = await this.getEditableQuote(id, user);
    const item = await this.itemRepo.findOne({
      where: { id: itemId, quoteId: id },
    });
    if (!item) {
      throw new NotFoundException('Dòng báo giá không tồn tại');
    }

    if (
      dto.productId !== undefined &&
      dto.productId !== null &&
      dto.productId !== item.productId
    ) {
      const product = await this.productRepo.findOne({
        where: { id: dto.productId },
      });
      if (!product) {
        throw new NotFoundException('Sản phẩm không tồn tại');
      }
      item.productId = product.id;
      if (dto.productCode === undefined) {
        item.productCode = product.productCode;
      }
      if (dto.name === undefined) {
        item.name = product.productName;
      }
      if (dto.costPrice === undefined) {
        item.costPrice = product.price ?? null;
      }
      if (dto.unitPrice === undefined) {
        item.unitPrice = item.costPrice;
      }
      if (dto.warranty === undefined) {
        item.warranty = productWarrantyText(product);
      }
      if (dto.pn === undefined) {
        item.pn = product.productCode;
      }
    }

    if (dto.productCode !== undefined) {
      const newCode = dto.productCode?.trim() || null;
      if (dto.pn === undefined && newCode && newCode !== item.productCode) {
        item.pn = newCode;
      }
      item.productCode = newCode;
    }
    if (dto.pn !== undefined) item.pn = dto.pn?.trim() || null;
    if (dto.name !== undefined) item.name = dto.name?.trim() || null;
    if (dto.description !== undefined) {
      item.description = dto.description?.trim() || null;
    }
    if (dto.warranty !== undefined) {
      item.warranty = dto.warranty?.trim() || null;
    }
    if (dto.costPrice !== undefined) item.costPrice = dto.costPrice;
    if (dto.unitPrice !== undefined) item.unitPrice = dto.unitPrice;
    if (dto.quantity !== undefined) item.quantity = dto.quantity;
    if (dto.statusText !== undefined) {
      item.statusText = normalizeStatusText(dto.statusText) || null;
    }
    if (dto.note !== undefined) item.note = dto.note?.trim() || null;
    if (dto.sortOrder !== undefined) item.sortOrder = dto.sortOrder;
    if (dto.isManual !== undefined) item.isManual = dto.isManual;
    if (dto.metadata !== undefined) item.metadata = dto.metadata;

    if (
      dto.unitPrice !== undefined ||
      dto.quantity !== undefined ||
      dto.productId !== undefined
    ) {
      item.lineTotal =
        item.unitPrice !== null && item.unitPrice !== undefined
          ? Number(item.unitPrice) * Number(item.quantity || 1)
          : null;
    }

    await this.itemRepo.save(item);
    await this.recalculateTotals(quote.id);
    return this.findOne(quote.id, user);
  }

  async removeItem(id: number, itemId: number, user: AuthenticatedUser) {
    const quote = await this.getEditableQuote(id, user);
    const item = await this.itemRepo.findOne({
      where: { id: itemId, quoteId: id },
    });
    if (!item) {
      throw new NotFoundException('Dòng báo giá không tồn tại');
    }
    await this.itemRepo.remove(item);
    await this.recalculateTotals(quote.id);
    return this.findOne(quote.id, user);
  }

  async reorderItems(id: number, itemIds: number[], user: AuthenticatedUser) {
    const quote = await this.getEditableQuote(id, user);
    const items = await this.itemRepo.find({ where: { quoteId: id } });
    const ownedIds = new Set(items.map((item) => item.id));

    for (const itemId of itemIds) {
      if (!ownedIds.has(itemId)) {
        throw new BadRequestException(
          `Dòng báo giá ${itemId} không thuộc báo giá này`,
        );
      }
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SaleQuoteItem);
      for (let index = 0; index < itemIds.length; index += 1) {
        await repo.update(
          { id: itemIds[index], quoteId: id },
          { sortOrder: index },
        );
      }
    });

    return this.findOne(quote.id, user);
  }

  async renderText(
    id: number,
    user: AuthenticatedUser,
    query: { mode?: string; zaloSuffix?: string } = {},
  ) {
    const quote = await this.findOne(id, user);
    const mode = query.mode || quote.mode || 'standard';
    const settings = await this.settingsService.getForUser(getUserId(user));
    const suffix =
      query.zaloSuffix !== undefined
        ? query.zaloSuffix
        : quote.zaloSuffix || settings.zaloSuffix || undefined;

    const finalGlobalNote =
      quote.globalNote?.trim() || settings.defaultGlobalNote?.trim() || null;
    const finalItems = (quote.items || []).map((item) => ({
      ...item,
      warranty: item.warranty?.trim() || null,
      statusText: item.statusText?.trim() || settings.defaultStatusText || null,
    }));
    const text = this.renderer.renderQuote(finalItems, {
      mode,
      title: quote.title,
      globalNote: finalGlobalNote,
      zaloSuffix: suffix,
      priceLabel: settings.priceLabel,
      showStockStatus: settings.showStockStatus ?? true,
    });

    return {
      text,
      mode,
      itemCount: (quote.items || []).length,
      totalAmount: quote.totalAmount,
      charCount: text.length,
    };
  }

  async recalculateTotals(id: number) {
    const items = await this.itemRepo.find({ where: { quoteId: id } });
    const totalAmount = sumLineTotals(items);
    const hasUnpricedItems = items.some(
      (item) =>
        item.unitPrice === null ||
        item.unitPrice === undefined ||
        Number(item.unitPrice) <= 0,
    );
    await this.quoteRepo.update(id, { totalAmount, hasUnpricedItems });
    return { totalAmount, hasUnpricedItems };
  }

  private buildItemEntity(
    quoteId: number,
    dto: QuoteItemInputDto,
    index: number,
    settings: Awaited<ReturnType<SaleSettingsService['getForUser']>>,
    rules: PricingRules,
    products: Map<number, Product>,
  ): SaleQuoteItem {
    const product = dto.productId
      ? products.get(Number(dto.productId))
      : undefined;
    if (dto.productId && !product) {
      throw new NotFoundException(
        `Sản phẩm ${dto.productId} không tồn tại`,
      );
    }
    const costPrice =
      dto.costPrice !== undefined
        ? dto.costPrice
        : product?.price !== null && product?.price !== undefined
          ? Number(product.price)
          : null;
    const unitPrice =
      dto.unitPrice !== undefined
        ? dto.unitPrice
        : costPrice;
    const quantity = Math.max(1, Number(dto.quantity) || 1);
    const statusText =
      dto.statusText !== undefined
        ? (normalizeStatusText(dto.statusText) || null)
        : computeStockStatus(product?.stock, settings.defaultStatusText);

    return this.itemRepo.create({
      quoteId,
      productId: product?.id ?? dto.productId ?? null,
      productCode: dto.productCode?.trim() || product?.productCode || null,
      pn: dto.pn?.trim() || null,
      name: dto.name?.trim() || product?.productName || 'Sản phẩm',
      description: dto.description?.trim() || null,
      // Bảo hành lấy từ sản phẩm (nếu có catalog), nếu thủ công thì lấy từ dto
      warranty: product ? productWarrantyText(product) : (dto.warranty?.trim() || null),
      costPrice,
      unitPrice,
      quantity,
      lineTotal: unitPrice !== null ? Number(unitPrice) * quantity : null,
      statusText,
      note: dto.note?.trim() || null,
      sortOrder: dto.sortOrder ?? index,
      isManual: dto.isManual ?? !product,
      metadata: dto.metadata ?? null,
    });
  }

  private async loadProductsForItems(
    items: Array<{ productId?: number | null; productCode?: string | null }>,
  ) {
    const productIds = Array.from(
      new Set(
        items
          .map((i) => Number(i.productId))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    );
    const productCodes = Array.from(
      new Set(
        items
          .map((i) => i.productCode?.trim())
          .filter((c): c is string => !!c),
      ),
    );

    interface InventoryResolvedInfo {
      costPrice?: number;
      stock?: number;
      warranty?: string | null;
      productName?: string;
      productCode?: string;
      rawStatus?: string | null;
      isS1: boolean;
    }

    const byId = new Map<number, InventoryResolvedInfo>();
    const byCode = new Map<string, InventoryResolvedInfo>();

    // 1. Quét từ Product (Kho S1)
    if (productIds.length > 0) {
      const prodsById = await this.productRepo.find({
        where: { id: In(productIds) },
      });
      for (const p of prodsById) {
        const info: InventoryResolvedInfo = {
          costPrice: p.price !== null && p.price !== undefined ? Number(p.price) : 0,
          stock: p.stock !== null && p.stock !== undefined ? Number(p.stock) : 0,
          warranty: productWarrantyText(p),
          productName: p.productName,
          productCode: p.productCode,
          isS1: true,
        };
        byId.set(p.id, info);
        if (p.productCode) byCode.set(p.productCode.trim().toLowerCase(), info);
      }
    }

    if (productCodes.length > 0) {
      const prodsByCode = await this.productRepo.find({
        where: { productCode: In(productCodes) },
      });
      for (const p of prodsByCode) {
        const info: InventoryResolvedInfo = {
          costPrice: p.price !== null && p.price !== undefined ? Number(p.price) : 0,
          stock: p.stock !== null && p.stock !== undefined ? Number(p.stock) : 0,
          warranty: productWarrantyText(p),
          productName: p.productName,
          productCode: p.productCode,
          isS1: true,
        };
        if (!byId.has(p.id)) byId.set(p.id, info);
        if (p.productCode) byCode.set(p.productCode.trim().toLowerCase(), info);
      }

      // 2. Quét từ SaleExcelItem (Bảng giá Excel Catalog mới nhất)
      try {
        const excelItems = await this.excelItemRepo
          .createQueryBuilder('ei')
          .where('UPPER(ei.productCode) IN (:...codes)', {
            codes: productCodes.map((c) => c.toUpperCase()),
          })
          .orderBy('ei.id', 'DESC')
          .getMany();

        for (const ei of excelItems) {
          const key = ei.productCode.trim().toLowerCase();
          const existing = byCode.get(key);

          const excelPrice =
            ei.price !== null && ei.price !== undefined ? Number(ei.price) : 0;
          const excelStock =
            ei.s1Matched && ei.s1StockQuantity !== null && ei.s1StockQuantity !== undefined
              ? Number(ei.s1StockQuantity)
              : undefined;

          if (existing) {
            if (excelPrice > 0) {
              existing.costPrice = excelPrice;
            }
            if (excelStock !== undefined) {
              existing.stock = excelStock;
            }
            if (ei.rawStatus) {
              existing.rawStatus = ei.rawStatus;
            }
          } else {
            const info: InventoryResolvedInfo = {
              costPrice: excelPrice,
              stock: excelStock ?? 0,
              warranty: ei.warranty || null,
              productName: ei.productName,
              productCode: ei.productCode,
              rawStatus: ei.rawStatus,
              isS1: false,
            };
            byCode.set(key, info);
          }
        }
      } catch (err) {
        // Safe check phòng lỗi query
      }
    }

    return {
      get: (
        productId?: number | null,
        productCode?: string | null,
      ): InventoryResolvedInfo | undefined => {
        if (productId && byId.has(Number(productId))) {
          return byId.get(Number(productId));
        }
        if (productCode && byCode.has(productCode.trim().toLowerCase())) {
          return byCode.get(productCode.trim().toLowerCase());
        }
        return undefined;
      },
    };
  }

  private async loadProducts(productIds: number[]) {
    const uniqueIds = Array.from(
      new Set(productIds.map((id) => Number(id)).filter((id) => id > 0)),
    );
    const products =
      uniqueIds.length > 0
        ? await this.productRepo.find({ where: { id: In(uniqueIds) } })
        : [];
    return new Map(products.map((product) => [product.id, product]));
  }

  private async getEditableQuote(id: number, user: AuthenticatedUser) {
    const quote = await this.quoteRepo.findOne({ where: { id } });
    if (!quote) {
      throw new NotFoundException('Báo giá không tồn tại');
    }
    assertOwnerOrAdmin(
      quote.saleUserId,
      user,
      'Bạn không có quyền sửa báo giá này',
    );
    return quote;
  }

  private assertCanRead(quote: SaleQuote, user: AuthenticatedUser) {
    const userId = getUserId(user);
    if (!canReadAll(user) && Number(quote.saleUserId) !== userId) {
      throw new NotFoundException('Báo giá không tồn tại');
    }
  }

  private async generateQuoteCode(): Promise<string> {
    const now = new Date();
    const datePart =
      String(now.getFullYear()).slice(-2) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const random = Math.random().toString(36).slice(2, 6).toUpperCase();
      const code = `BG-${datePart}-${random}`;
      const exists = await this.quoteRepo.count({ where: { quoteCode: code } });
      if (!exists) {
        return code;
      }
    }
    return `BG-${datePart}-${Date.now().toString(36).toUpperCase()}`;
  }
}
