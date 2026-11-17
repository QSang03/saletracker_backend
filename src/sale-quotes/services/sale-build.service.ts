import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Product } from '../../products/product.entity';
import { SaleExcelItem } from '../entities/sale-excel-item.entity';
import { SaleBuild } from '../entities/sale-build.entity';
import { SaleBuildItem } from '../entities/sale-build-item.entity';
import {
  BuildItemInputDto,
  CreateBuildDto,
  QueryBuildDto,
  UpdateBuildDto,
  UpdateBuildItemDto,
} from '../dto/build.dto';
import { SaleSettingsService } from './sale-settings.service';
import { SalePricingService } from './sale-pricing.service';
import { SaleTextRendererService } from './sale-text-renderer.service';
import { AuthenticatedUser } from '../types/auth-user.type';
import {
  assertCanMutate,
  assertOwnerOrAdmin,
  canReadAll,
  canReadOwnerResource,
  getUserId,
} from '../utils/entity-access.util';
import {
  DEFAULT_BUILD_FOLDER,
  PricingRules,
  DEFAULT_STATUS_TEXT,
} from '../sale-quote.constants';
import {
  computeStockStatus,
  normalizeStatusText,
  productWarrantyText,
  sumLineTotals,
} from '../utils/text.util';

@Injectable()
export class SaleBuildService {
  constructor(
    @InjectRepository(SaleBuild)
    private readonly buildRepo: Repository<SaleBuild>,
    @InjectRepository(SaleBuildItem)
    private readonly itemRepo: Repository<SaleBuildItem>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(SaleExcelItem)
    private readonly excelItemRepo: Repository<SaleExcelItem>,
    private readonly dataSource: DataSource,
    private readonly settingsService: SaleSettingsService,
    private readonly pricingService: SalePricingService,
    private readonly renderer: SaleTextRendererService,
  ) {}

  async create(dto: CreateBuildDto, user: AuthenticatedUser) {
    assertCanMutate(user);
    const userId = getUserId(user);
    const settings = await this.settingsService.getForUser(userId);
    const rules = await this.settingsService.getEffectiveRules(userId);
    const itemDtos = dto.items || [];
    const products = await this.loadProducts(
      itemDtos.map((item) => item.productId).filter(Boolean) as number[],
    );

    const build = this.buildRepo.create({
      ownerUserId: userId,
      name: dto.name.trim(),
      folder: dto.folder?.trim() || DEFAULT_BUILD_FOLDER,
      description: dto.description?.trim() || null,
      specs: this.sanitizeSpecs(dto.specs),
      isShared: dto.isShared ?? false,
      isTemplate: dto.isTemplate ?? false,
      sortOrder: dto.sortOrder ?? 0,
    });
    const saved = await this.buildRepo.save(build);

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

  async findAll(query: QueryBuildDto, user: AuthenticatedUser) {
    const userId = getUserId(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Math.min(Number(query.pageSize) || 20, 100));
    const readAll = canReadAll(user);

    const qb = this.buildRepo
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.ownerUser', 'u')
      .loadRelationCountAndMap('b.itemCount', 'b.items')
      .orderBy('b.sortOrder', 'ASC')
      .addOrderBy('b.createdAt', 'DESC');

    if (query.mine || (!readAll && query.includeShared === false)) {
      qb.andWhere('b.owner_user_id = :userId', { userId });
    } else if (!readAll) {
      // Mặc định sale thấy cấu hình của mình + cấu hình được chia sẻ
      qb.andWhere(
        '(b.owner_user_id = :userId OR b.is_shared = :shared)',
        { userId, shared: true },
      );
    }

    if (query.folder?.trim()) {
      const folderVal = query.folder.trim();
      qb.andWhere('(b.folder = :folder OR b.folder LIKE :folderPrefix)', {
        folder: folderVal,
        folderPrefix: `${folderVal} / %`,
      });
    }
    if (query.search?.trim()) {
      const keyword = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        `(
          LOWER(b.name) LIKE :keyword 
          OR LOWER(b.description) LIKE :keyword 
          OR EXISTS (
            SELECT 1 FROM sale_build_items sbi 
            WHERE sbi.build_id = b.id 
            AND (
              LOWER(sbi.name) LIKE :keyword 
              OR LOWER(sbi.description) LIKE :keyword 
              OR LOWER(sbi.product_code) LIKE :keyword 
              OR LOWER(sbi.pn) LIKE :keyword
            )
          )
        )`,
        { keyword },
      );
    }

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, pageSize };
  }

  async findOne(id: number, user: AuthenticatedUser) {
    const build = await this.buildRepo
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.ownerUser', 'u')
      .leftJoinAndSelect('b.items', 'i')
      .where('b.id = :id', { id })
      .orderBy('i.sortOrder', 'ASC')
      .addOrderBy('i.id', 'ASC')
      .getOne();

    if (!build) {
      throw new NotFoundException('Cấu hình máy ráp không tồn tại');
    }
    this.assertCanRead(build, user);

    const userId = getUserId(user);
    const rules = await this.settingsService.getEffectiveRules(userId);
    const productMap = await this.loadProductsForItems(build.items || []);

    const itemsToPersist: SaleBuildItem[] = [];

    const updatedItems = (build.items || []).map((item) => {
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
      let resolvedSalePrice = item.salePrice;
      if (!item.isManual && resolvedCostPrice !== null && resolvedCostPrice !== undefined && Number(resolvedCostPrice) > 0) {
        const wasEqualCost = !item.salePrice || item.salePrice === item.costPrice;
        if (wasEqualCost) {
          resolvedSalePrice = resolvedCostPrice;
        } else {
          const suggested = this.pricingService.suggestSalePrice(resolvedCostPrice, rules);
          resolvedSalePrice = suggested || resolvedCostPrice;
        }
      }

      // 4. Thành tiền mới nhất
      const qty = Math.max(1, Number(item.quantity) || 1);
      const resolvedLineTotal =
        resolvedSalePrice !== null && resolvedSalePrice !== undefined
          ? resolvedSalePrice * qty
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

      // Kiểm tra xem có thay đổi so với DB không để lưu ngầm đồng bộ
      const hasChanged =
        (resolvedCostPrice !== null && resolvedCostPrice !== item.costPrice) ||
        (resolvedSalePrice !== null && resolvedSalePrice !== item.salePrice) ||
        (resolvedLineTotal !== null && resolvedLineTotal !== item.lineTotal) ||
        (resolvedStatusText && resolvedStatusText !== item.statusText);

      if (hasChanged && item.id) {
        item.costPrice = resolvedCostPrice;
        item.salePrice = resolvedSalePrice;
        item.lineTotal = resolvedLineTotal;
        item.statusText = resolvedStatusText;
        itemsToPersist.push(item);
      }

      return {
        ...item,
        pn: resolvedPn,
        stock: resolvedStock,
        costPrice: resolvedCostPrice,
        salePrice: resolvedSalePrice,
        lineTotal: resolvedLineTotal,
        warranty: resolvedWarranty,
        statusText: resolvedStatusText,
      };
    });

    // Lưu ngầm các thay đổi vào DB để mọi nơi đều đồng bộ
    if (itemsToPersist.length > 0) {
      this.itemRepo.save(itemsToPersist).then(() => {
        this.recalculateTotals(build.id);
      }).catch((err) => {
        console.error('Lỗi khi lưu đồng bộ kho cho build:', err);
      });
    }

    const calculatedTotal = updatedItems.reduce((sum, it) => sum + (it.lineTotal || 0), 0);

    return {
      ...build,
      totalAmount: calculatedTotal > 0 ? calculatedTotal : build.totalAmount,
      items: updatedItems,
    };
  }

  async update(id: number, dto: UpdateBuildDto, user: AuthenticatedUser) {
    const build = await this.getEditableBuild(id, user);

    if (dto.name !== undefined) build.name = dto.name.trim();
    if (dto.folder !== undefined) {
      build.folder = dto.folder?.trim() || DEFAULT_BUILD_FOLDER;
    }
    if (dto.description !== undefined) {
      build.description = dto.description?.trim() || null;
    }
    if (dto.specs !== undefined) build.specs = this.sanitizeSpecs(dto.specs);
    if (dto.isShared !== undefined) build.isShared = dto.isShared;
    if (dto.isTemplate !== undefined) build.isTemplate = dto.isTemplate;
    if (dto.sortOrder !== undefined) build.sortOrder = dto.sortOrder;

    await this.buildRepo.save(build);
    return this.findOne(id, user);
  }

  async remove(id: number, user: AuthenticatedUser) {
    const build = await this.getEditableBuild(id, user);
    await this.buildRepo.softRemove(build);
    return { success: true };
  }

  async duplicate(id: number, user: AuthenticatedUser) {
    assertCanMutate(user);
    const source = await this.buildRepo
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.items', 'i')
      .where('b.id = :id', { id })
      .orderBy('i.sortOrder', 'ASC')
      .getOne();

    if (!source) {
      throw new NotFoundException('Cấu hình máy ráp không tồn tại');
    }
    this.assertCanRead(source, user);

    const saved = await this.buildRepo.save(
      this.buildRepo.create({
        ownerUserId: getUserId(user),
        name: `${source.name} (Bản sao)`,
        folder: source.folder,
        description: source.description,
        specs: source.specs,
        isShared: false,
        isTemplate: false,
        sortOrder: source.sortOrder,
      }),
    );

    const items = (source.items || []).map((item, index) =>
      this.itemRepo.create({
        buildId: saved.id,
        productId: item.productId,
        productCode: item.productCode,
        pn: item.pn,
        name: item.name,
        description: item.description,
        warranty: item.warranty,
        costPrice: item.costPrice,
        salePrice: item.salePrice,
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

  async addItem(id: number, dto: BuildItemInputDto, user: AuthenticatedUser) {
    const build = await this.getEditableBuild(id, user);
    const userId = getUserId(user);
    const settings = await this.settingsService.getForUser(userId);
    const rules = await this.settingsService.getEffectiveRules(userId);
    const products = await this.loadProducts(
      dto.productId ? [dto.productId] : [],
    );

    const maxOrder = await this.itemRepo
      .createQueryBuilder('i')
      .select('MAX(i.sort_order)', 'max')
      .where('i.build_id = :id', { id })
      .getRawOne<{ max: string | null }>();
    const nextOrder = Number(maxOrder?.max ?? -1) + 1;

    const entity = this.buildItemEntity(
      build.id,
      dto,
      dto.sortOrder ?? nextOrder,
      settings,
      rules,
      products,
    );
    await this.itemRepo.save(entity);
    await this.recalculateTotals(build.id);
    return this.findOne(build.id, user);
  }

  async updateItem(
    id: number,
    itemId: number,
    dto: UpdateBuildItemDto,
    user: AuthenticatedUser,
  ) {
    const build = await this.getEditableBuild(id, user);
    const item = await this.itemRepo.findOne({
      where: { id: itemId, buildId: id },
    });
    if (!item) {
      throw new NotFoundException('Linh kiện trong cấu hình không tồn tại');
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
      if (dto.name === undefined) item.name = product.productName;
      if (dto.costPrice === undefined) item.costPrice = product.price ?? null;
      if (dto.salePrice === undefined) {
        item.salePrice = item.costPrice;
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
    if (dto.salePrice !== undefined) item.salePrice = dto.salePrice;
    if (dto.quantity !== undefined) item.quantity = dto.quantity;
    if (dto.statusText !== undefined) {
      item.statusText = normalizeStatusText(dto.statusText) || null;
    }
    if (dto.note !== undefined) item.note = dto.note?.trim() || null;
    if (dto.sortOrder !== undefined) item.sortOrder = dto.sortOrder;
    if (dto.isManual !== undefined) item.isManual = dto.isManual;
    if (dto.metadata !== undefined) item.metadata = dto.metadata;

    if (
      dto.salePrice !== undefined ||
      dto.quantity !== undefined ||
      dto.productId !== undefined
    ) {
      item.lineTotal =
        item.salePrice !== null && item.salePrice !== undefined
          ? Number(item.salePrice) * Number(item.quantity || 1)
          : null;
    }

    await this.itemRepo.save(item);
    await this.recalculateTotals(build.id);
    return this.findOne(build.id, user);
  }

  async removeItem(id: number, itemId: number, user: AuthenticatedUser) {
    const build = await this.getEditableBuild(id, user);
    const item = await this.itemRepo.findOne({
      where: { id: itemId, buildId: id },
    });
    if (!item) {
      throw new NotFoundException('Linh kiện trong cấu hình không tồn tại');
    }
    await this.itemRepo.remove(item);
    await this.recalculateTotals(build.id);
    return this.findOne(build.id, user);
  }

  async reorderItems(id: number, itemIds: number[], user: AuthenticatedUser) {
    const build = await this.getEditableBuild(id, user);
    const items = await this.itemRepo.find({ where: { buildId: id } });
    const ownedIds = new Set(items.map((item) => item.id));

    for (const itemId of itemIds) {
      if (!ownedIds.has(itemId)) {
        throw new BadRequestException(
          `Linh kiện ${itemId} không thuộc cấu hình này`,
        );
      }
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SaleBuildItem);
      for (let index = 0; index < itemIds.length; index += 1) {
        await repo.update(
          { id: itemIds[index], buildId: id },
          { sortOrder: index },
        );
      }
    });

    return this.findOne(build.id, user);
  }

  async renderText(
    id: number,
    user: AuthenticatedUser,
    includeSpecs = false,
    zaloSuffix?: string,
  ) {
    const build = await this.findOne(id, user);
    const settings = await this.settingsService.getForUser(getUserId(user));
    const items = (build.items || []).map((item) => ({
      ...item,
      unitPrice: item.salePrice,
    }));
    const text = this.renderer.renderBuild(items, {
      includeSpecs,
      specs: build.specs,
      zaloSuffix: zaloSuffix ?? settings.zaloSuffix ?? undefined,
      priceLabel: settings.priceLabel,
      showStockStatus: settings.showStockStatus ?? true,
    });
    return {
      text,
      itemCount: (build.items || []).length,
      totalAmount: build.totalAmount,
      charCount: text.length,
    };
  }

  async recalculateTotals(id: number) {
    const items = await this.itemRepo.find({ where: { buildId: id } });
    const totalAmount = sumLineTotals(items);
    const hasUnpricedItems = items.some(
      (item) =>
        item.salePrice === null ||
        item.salePrice === undefined ||
        Number(item.salePrice) <= 0,
    );
    await this.buildRepo.update(id, { totalAmount, hasUnpricedItems });
    return { totalAmount, hasUnpricedItems };
  }

  async listFolders(user: AuthenticatedUser) {
    const userId = getUserId(user);
    const readAll = canReadAll(user);
    const qb = this.buildRepo
      .createQueryBuilder('b')
      .select('b.folder', 'folder')
      .addSelect('COUNT(*)', 'count')
      .groupBy('b.folder')
      .orderBy('b.folder', 'ASC');

    if (!readAll) {
      qb.where('(b.owner_user_id = :userId OR b.is_shared = :shared)', {
        userId,
        shared: true,
      });
    }

    const rows = await qb.getRawMany<{ folder: string; count: string }>();
    return rows.map((row) => ({
      folder: row.folder,
      count: Number(row.count) || 0,
    }));
  }

  private buildItemEntity(
    buildId: number,
    dto: BuildItemInputDto,
    index: number,
    settings: Awaited<ReturnType<SaleSettingsService['getForUser']>>,
    rules: PricingRules,
    products: Map<number, Product>,
  ): SaleBuildItem {
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
    const salePrice =
      dto.salePrice !== undefined
        ? dto.salePrice
        : costPrice;
    const quantity = Math.max(1, Number(dto.quantity) || 1);
    const statusText =
      dto.statusText !== undefined
        ? (normalizeStatusText(dto.statusText) || null)
        : computeStockStatus(product?.stock, settings.defaultStatusText);

    return this.itemRepo.create({
      buildId,
      productId: product?.id ?? dto.productId ?? null,
      productCode: dto.productCode?.trim() || product?.productCode || null,
      pn: dto.pn?.trim() || product?.productCode || null,
      name: dto.name?.trim() || product?.productName || 'Linh kiện',
      description: dto.description?.trim() || null,
      warranty: dto.warranty?.trim() || productWarrantyText(product),
      costPrice,
      salePrice,
      quantity,
      lineTotal: salePrice !== null ? Number(salePrice) * quantity : null,
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

  private sanitizeSpecs(
    specs?: Array<{ label?: string; value?: string }> | null,
  ): Array<{ label: string; value: string }> | null {
    if (!specs) {
      return null;
    }
    return specs
      .map((spec) => ({
        label: (spec.label || '').trim(),
        value: (spec.value || '').trim(),
      }))
      .filter((spec) => spec.label || spec.value);
  }

  private async getEditableBuild(id: number, user: AuthenticatedUser) {
    const build = await this.buildRepo.findOne({ where: { id } });
    if (!build) {
      throw new NotFoundException('Cấu hình máy ráp không tồn tại');
    }
    assertOwnerOrAdmin(
      build.ownerUserId,
      user,
      'Bạn không có quyền sửa cấu hình này',
    );
    return build;
  }

  private assertCanRead(build: SaleBuild, user: AuthenticatedUser) {
    if (!canReadOwnerResource(build.ownerUserId, user, build.isShared)) {
      throw new NotFoundException('Cấu hình máy ráp không tồn tại');
    }
  }
}
