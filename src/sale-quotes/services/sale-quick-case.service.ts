import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Product } from '../../products/product.entity';
import { SaleQuickQuoteCase } from '../entities/sale-quick-quote-case.entity';
import { SaleQuickQuoteItem } from '../entities/sale-quick-quote-item.entity';
import {
  BulkQuickCaseDto,
  CreateQuickCaseDto,
  QueryQuickCaseDto,
  QuickCaseItemInputDto,
  UpdateQuickCaseDto,
  UpdateQuickCaseItemDto,
} from '../dto/quick-case.dto';
import { SaleSettingsService } from './sale-settings.service';
import { SalePricingService } from './sale-pricing.service';
import { SaleTextRendererService } from './sale-text-renderer.service';
import {
  assertCanMutate,
  assertOwnerOrAdmin,
  canReadAll,
  getUserId,
} from '../utils/entity-access.util';
import { normalizeStatusText, sumLineTotals } from '../utils/text.util';

@Injectable()
export class SaleQuickCaseService {
  constructor(
    @InjectRepository(SaleQuickQuoteCase)
    private readonly caseRepo: Repository<SaleQuickQuoteCase>,
    @InjectRepository(SaleQuickQuoteItem)
    private readonly itemRepo: Repository<SaleQuickQuoteItem>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly dataSource: DataSource,
    private readonly settingsService: SaleSettingsService,
    private readonly pricingService: SalePricingService,
    private readonly renderer: SaleTextRendererService,
  ) {}

  async create(dto: CreateQuickCaseDto, user: any) {
    assertCanMutate(user);
    const userId = getUserId(user);
    const settings = await this.settingsService.getForUser(userId);
    const rules = await this.settingsService.getEffectiveRules(userId);
    const itemDtos = dto.items || [];
    const products = await this.loadProducts(
      itemDtos.map((item) => item.productId).filter(Boolean) as number[],
    );

    const quickCase = this.caseRepo.create({
      ownerUserId: userId,
      title: dto.title?.trim() || null,
      customerName: dto.customerName?.trim() || null,
      customerPhone: dto.customerPhone?.trim() || null,
      globalNote:
        dto.globalNote?.trim() || settings.defaultGlobalNote?.trim() || null,
      status: dto.status || 'draft',
      metadata: dto.metadata ?? null,
    });
    const saved = await this.caseRepo.save(quickCase);

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

  /**
   * Nhận danh sách yêu cầu dạng nhiều dòng (giống bqnProcessBulkInput):
   * mỗi dòng tạo 1 item ở trạng thái chưa map sản phẩm.
   */
  async createBulk(dto: BulkQuickCaseDto, user: any) {
    assertCanMutate(user);
    const lines = String(dto.rawText || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      throw new BadRequestException('Không có nội dung yêu cầu nào');
    }

    return this.create(
      {
        title: dto.title,
        globalNote: dto.globalNote,
        items: lines.map((line) => ({
          requestText: line,
          matchType: 'custom',
          quantity: 1,
        })),
      },
      user,
    );
  }

  async findAll(query: QueryQuickCaseDto, user: any) {
    const userId = getUserId(user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Math.min(Number(query.pageSize) || 20, 100));
    const readAll = canReadAll(user);

    const qb = this.caseRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.ownerUser', 'u')
      .leftJoinAndSelect('c.items', 'i')
      .loadRelationCountAndMap('c.itemCount', 'c.items')
      .orderBy('c.createdAt', 'DESC')
      .addOrderBy('c.id', 'DESC');

    if (query.mine || !readAll) {
      qb.andWhere('c.owner_user_id = :userId', { userId });
    }
    if (query.status) {
      qb.andWhere('c.status = :status', { status: query.status });
    }
    if (query.search?.trim()) {
      const keyword = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        `(LOWER(c.title) LIKE :keyword
          OR LOWER(c.customer_name) LIKE :keyword
          OR LOWER(c.customer_phone) LIKE :keyword)`,
        { keyword },
      );
    }

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [rows, total] = await qb.getManyAndCount();
    const rules = await this.settingsService.getEffectiveRules(userId);

    const data = rows.map((quickCase) => {
      const items = [...(quickCase.items || [])].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
      );
      return {
        ...quickCase,
        items: items.map((item) => ({
          ...item,
          customerPrice: this.pricingService.customerPrice(
            item.salePrice,
            rules,
          ),
        })),
        itemCount: items.length,
        pricingRules: rules,
      };
    });

    return { data, total, page, pageSize, pricingRules: rules };
  }

  async findOne(id: number, user: any) {
    const quickCase = await this.caseRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.ownerUser', 'u')
      .leftJoinAndSelect('c.items', 'i')
      .where('c.id = :id', { id })
      .orderBy('i.sortOrder', 'ASC')
      .addOrderBy('i.id', 'ASC')
      .getOne();

    if (!quickCase) {
      throw new NotFoundException('Case báo giá nhanh không tồn tại');
    }
    this.assertCanRead(quickCase, user);

    const rules = await this.settingsService.getEffectiveRules(getUserId(user));
    return {
      ...quickCase,
      items: (quickCase.items || []).map((item) => ({
        ...item,
        customerPrice: this.pricingService.customerPrice(item.salePrice, rules),
      })),
      pricingRules: rules,
    };
  }

  async update(id: number, dto: UpdateQuickCaseDto, user: any) {
    const quickCase = await this.getEditableCase(id, user);

    if (dto.title !== undefined) {
      quickCase.title = dto.title?.trim() || null;
    }
    if (dto.customerName !== undefined) {
      quickCase.customerName = dto.customerName?.trim() || null;
    }
    if (dto.customerPhone !== undefined) {
      quickCase.customerPhone = dto.customerPhone?.trim() || null;
    }
    if (dto.globalNote !== undefined) {
      quickCase.globalNote = dto.globalNote?.trim() || null;
    }
    if (dto.status !== undefined) quickCase.status = dto.status;
    if (dto.metadata !== undefined) quickCase.metadata = dto.metadata;

    await this.caseRepo.save(quickCase);
    return this.findOne(id, user);
  }

  async remove(id: number, user: any) {
    const quickCase = await this.getEditableCase(id, user);
    await this.caseRepo.softRemove(quickCase);
    return { success: true };
  }

  async duplicate(id: number, user: any) {
    assertCanMutate(user);
    const source = await this.caseRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.items', 'i')
      .where('c.id = :id', { id })
      .orderBy('i.sortOrder', 'ASC')
      .getOne();

    if (!source) {
      throw new NotFoundException('Case báo giá nhanh không tồn tại');
    }
    this.assertCanRead(source, user);

    const saved = await this.caseRepo.save(
      this.caseRepo.create({
        ownerUserId: getUserId(user),
        title: source.title ? `${source.title} (Bản sao)` : 'Bản sao',
        customerName: source.customerName,
        customerPhone: source.customerPhone,
        globalNote: source.globalNote,
        status: 'draft',
        metadata: source.metadata,
      }),
    );

    const items = (source.items || []).map((item, index) =>
      this.itemRepo.create({
        caseId: saved.id,
        requestText: item.requestText,
        matchType: item.matchType,
        productId: item.productId,
        productCode: item.productCode,
        pn: item.pn,
        description: item.description,
        warranty: item.warranty,
        costPrice: item.costPrice,
        salePrice: item.salePrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        statusText: item.statusText,
        note: item.note,
        sortOrder: index,
      }),
    );
    if (items.length > 0) {
      await this.itemRepo.save(items);
    }
    await this.recalculateTotals(saved.id);
    return this.findOne(saved.id, user);
  }

  async addItem(id: number, dto: QuickCaseItemInputDto, user: any) {
    const quickCase = await this.getEditableCase(id, user);
    const userId = getUserId(user);
    const settings = await this.settingsService.getForUser(userId);
    const rules = await this.settingsService.getEffectiveRules(userId);
    const products = await this.loadProducts(
      dto.productId ? [dto.productId] : [],
    );

    const maxOrder = await this.itemRepo
      .createQueryBuilder('i')
      .select('MAX(i.sort_order)', 'max')
      .where('i.case_id = :id', { id })
      .getRawOne<{ max: string | null }>();
    const nextOrder = Number(maxOrder?.max ?? -1) + 1;

    const entity = this.buildItemEntity(
      quickCase.id,
      dto,
      dto.sortOrder ?? nextOrder,
      settings,
      rules,
      products,
    );
    await this.itemRepo.save(entity);
    await this.recalculateTotals(quickCase.id);
    return this.findOne(quickCase.id, user);
  }

  async updateItem(
    id: number,
    itemId: number,
    dto: UpdateQuickCaseItemDto,
    user: any,
  ) {
    const quickCase = await this.getEditableCase(id, user);
    const item = await this.itemRepo.findOne({
      where: { id: itemId, caseId: id },
    });
    if (!item) {
      throw new NotFoundException('Dòng báo giá nhanh không tồn tại');
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
      if (dto.productCode === undefined) item.productCode = product.productCode;
      if (dto.description === undefined) item.description = product.productName;
      if (dto.costPrice === undefined) item.costPrice = product.price ?? null;
      if (dto.salePrice === undefined) {
        item.salePrice = this.pricingService.suggestSalePrice(
          item.costPrice,
          await this.settingsService.getEffectiveRules(getUserId(user)),
        );
      }
    }

    if (dto.requestText !== undefined) item.requestText = dto.requestText;
    if (dto.matchType !== undefined) item.matchType = dto.matchType;
    if (dto.productCode !== undefined) {
      item.productCode = dto.productCode?.trim() || null;
    }
    if (dto.pn !== undefined) item.pn = dto.pn?.trim() || null;
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
    await this.recalculateTotals(quickCase.id);
    return this.findOne(quickCase.id, user);
  }

  async removeItem(id: number, itemId: number, user: any) {
    const quickCase = await this.getEditableCase(id, user);
    const item = await this.itemRepo.findOne({
      where: { id: itemId, caseId: id },
    });
    if (!item) {
      throw new NotFoundException('Dòng báo giá nhanh không tồn tại');
    }
    await this.itemRepo.remove(item);
    await this.recalculateTotals(quickCase.id);
    return this.findOne(quickCase.id, user);
  }

  async reorderItems(id: number, itemIds: number[], user: any) {
    const quickCase = await this.getEditableCase(id, user);
    const items = await this.itemRepo.find({ where: { caseId: id } });
    const ownedIds = new Set(items.map((item) => item.id));

    for (const itemId of itemIds) {
      if (!ownedIds.has(itemId)) {
        throw new BadRequestException(
          `Dòng báo giá nhanh ${itemId} không thuộc case này`,
        );
      }
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SaleQuickQuoteItem);
      for (let index = 0; index < itemIds.length; index += 1) {
        await repo.update(
          { id: itemIds[index], caseId: id },
          { sortOrder: index },
        );
      }
    });

    return this.findOne(quickCase.id, user);
  }

  async renderText(id: number, user: any, zaloSuffix?: string) {
    const quickCase = await this.findOne(id, user);
    const settings = await this.settingsService.getForUser(getUserId(user));
    const finalGlobalNote =
      quickCase.globalNote?.trim() || settings.defaultGlobalNote?.trim() || null;
    const finalItems = (quickCase.items || []).map((item) => ({
      ...item,
      warranty: item.warranty?.trim() || settings.defaultWarranty || null,
      statusText: item.statusText?.trim() || settings.defaultStatusText || null,
    }));
    const text = this.renderer.renderQuickCase(
      { title: quickCase.title, globalNote: finalGlobalNote },
      finalItems,
      { zaloSuffix: zaloSuffix ?? settings.zaloSuffix ?? undefined },
    );
    return {
      text,
      itemCount: (quickCase.items || []).length,
      totalAmount: quickCase.totalAmount,
      charCount: text.length,
    };
  }

  async recalculateTotals(id: number) {
    const items = await this.itemRepo.find({ where: { caseId: id } });
    const totalAmount = sumLineTotals(items);
    const hasUnpricedItems = items.some(
      (item) =>
        item.salePrice === null ||
        item.salePrice === undefined ||
        Number(item.salePrice) <= 0,
    );
    await this.caseRepo.update(id, { totalAmount, hasUnpricedItems });
    return { totalAmount, hasUnpricedItems };
  }

  private buildItemEntity(
    caseId: number,
    dto: QuickCaseItemInputDto,
    index: number,
    settings: Awaited<ReturnType<SaleSettingsService['getForUser']>>,
    rules: any,
    products: Map<number, Product>,
  ): SaleQuickQuoteItem {
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
        : this.pricingService.suggestSalePrice(costPrice, rules);
    const quantity = Math.max(1, Number(dto.quantity) || 1);
    const statusText =
      normalizeStatusText(dto.statusText ?? settings.defaultStatusText) ||
      null;

    return this.itemRepo.create({
      caseId,
      requestText: dto.requestText?.trim() || null,
      matchType: dto.matchType || 'custom',
      productId: product?.id ?? dto.productId ?? null,
      productCode: dto.productCode?.trim() || product?.productCode || null,
      pn: dto.pn?.trim() || null,
      description: dto.description?.trim() || product?.productName || null,
      warranty: dto.warranty?.trim() || settings.defaultWarranty || null,
      costPrice,
      salePrice,
      quantity,
      lineTotal: salePrice !== null ? Number(salePrice) * quantity : null,
      statusText,
      note: dto.note?.trim() || null,
      sortOrder: dto.sortOrder ?? index,
    });
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

  private async getEditableCase(id: number, user: any) {
    const quickCase = await this.caseRepo.findOne({ where: { id } });
    if (!quickCase) {
      throw new NotFoundException('Case báo giá nhanh không tồn tại');
    }
    assertOwnerOrAdmin(
      quickCase.ownerUserId,
      user,
      'Bạn không có quyền sửa case báo giá này',
    );
    return quickCase;
  }

  private assertCanRead(quickCase: SaleQuickQuoteCase, user: any) {
    if (
      !canReadAll(user) &&
      Number(quickCase.ownerUserId) !== getUserId(user)
    ) {
      throw new NotFoundException('Case báo giá nhanh không tồn tại');
    }
  }
}
