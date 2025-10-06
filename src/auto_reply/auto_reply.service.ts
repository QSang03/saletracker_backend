import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AutoReplySalesPersona } from '../auto_reply_sales_personas/auto_reply_sales_persona.entity';
import { AutoReplyContact, ContactRole } from '../auto_reply_contacts/auto_reply_contact.entity';
import { AutoReplyCustomerProfile } from '../auto_reply_customer_profiles/auto_reply_customer_profile.entity';
import { AutoReplyProduct } from '../auto_reply_products/auto_reply_product.entity';
import { AutoReplyContactAllowedProduct } from '../auto_reply_contact_allowed_products/auto_reply_contact_allowed_product.entity';
import { AutoReplyKeywordRoute } from '../auto_reply_keyword_routes/auto_reply_keyword_route.entity';
import { AutoReplyRouteProduct } from '../auto_reply_products/auto_reply_route_product.entity';
import { AutoReplyConversation } from '../auto_reply_conversations/auto_reply_conversation.entity';
import { AutoReplyMessage } from '../auto_reply_messages/auto_reply_message.entity';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { NKCProduct } from '../nkc_products/nkc_product.entity';
import { User } from '../users/user.entity';
import * as ExcelJS from 'exceljs';

@Injectable()
export class AutoReplyService {
  constructor(
    @InjectRepository(AutoReplySalesPersona)
    private personaRepo: Repository<AutoReplySalesPersona>,
    @InjectRepository(AutoReplyContact)
    private contactRepo: Repository<AutoReplyContact>,
    @InjectRepository(AutoReplyCustomerProfile)
    private profileRepo: Repository<AutoReplyCustomerProfile>,
    @InjectRepository(AutoReplyProduct)
    private productRepo: Repository<AutoReplyProduct>,
    @InjectRepository(AutoReplyContactAllowedProduct)
    private capRepo: Repository<AutoReplyContactAllowedProduct>,
    @InjectRepository(AutoReplyKeywordRoute)
    private routeRepo: Repository<AutoReplyKeywordRoute>,
    @InjectRepository(AutoReplyRouteProduct)
    private rpRepo: Repository<AutoReplyRouteProduct>,
    @InjectRepository(AutoReplyConversation)
    private convRepo: Repository<AutoReplyConversation>,
    @InjectRepository(AutoReplyMessage)
    private msgRepo: Repository<AutoReplyMessage>,
    @InjectRepository(NKCProduct)
    private nkcRepo: Repository<NKCProduct>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private readonly ws: WebsocketGateway,
  ) {}

  // Helper method to get user's main department slug (department with server_ip)
  private async getUserMainDepartmentSlug(userId: number): Promise<string | null> {
    if (!userId) {
      console.log(`[DEBUG] getUserMainDepartmentSlug - userId is null/undefined`);
      return null;
    }
    
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['departments'],
    });
    
    console.log(`[DEBUG] getUserMainDepartmentSlug - userId: ${userId}, user found: ${!!user}, departments count: ${user?.departments?.length || 0}`);
    
    if (!user || !user.departments) {
      console.log(`[DEBUG] getUserMainDepartmentSlug - No user or departments found`);
      return null;
    }
    
    // Find department with server_ip (main department)
    const mainDepartment = user.departments.find(
      (dept) => dept.server_ip && dept.server_ip.trim() !== ''
    );
    
    console.log(`[DEBUG] getUserMainDepartmentSlug - Main department found: ${!!mainDepartment}, slug: ${mainDepartment?.slug}`);
    
    return mainDepartment?.slug || null;
  }

  // Persona
  async getMyPersona(userId: number) {
    if (userId === undefined || userId === null) return null as any;
    const persona = await this.personaRepo.findOne({
      where: { user: { id: userId } as any },
      relations: ['user'],
    });
    if (!persona) return null as any;
    // Ensure minimal user payload
    const safe = { ...(persona as any) };
    safe.user = persona.user
      ? { id: (persona.user as any).id }
      : { id: userId };
    return safe as any;
  }
  // List all personas for a user
  async listMyPersonas(userId: number) {
    if (userId === undefined || userId === null) return [] as any;
    const personas = await this.personaRepo.find({
      where: { user: { id: userId } as any },
      relations: ['user'],
      order: { updatedAt: 'DESC' as any },
    } as any);
    return personas.map((p: any) => ({
      ...p,
      user: p.user ? { id: p.user.id } : { id: userId },
    }));
  }
  async upsertPersona(userId: number, payload: Partial<AutoReplySalesPersona>) {
    const existing = await this.personaRepo.findOne({
      where: { user: { id: userId } as any },
    });
    let toSave: AutoReplySalesPersona;
    if (!existing) {
      toSave = this.personaRepo.create({
        name: payload.name!,
        personaPrompt: payload.personaPrompt!,
        user: { id: userId } as any,
      } as Partial<AutoReplySalesPersona>) as AutoReplySalesPersona;
    } else {
      existing.name = payload.name ?? existing.name;
      existing.personaPrompt = payload.personaPrompt ?? existing.personaPrompt;
      toSave = existing;
    }
    const savedRaw = await this.personaRepo.save(toSave);
    const saved = await this.personaRepo.findOne({
      where: { personaId: savedRaw.personaId },
      relations: ['user'],
    });
    this.ws.emitToUser(String(userId), 'autoReply:personaUpdated', {
      personaId: savedRaw.personaId,
    });
    const safe = { ...(saved as any) };
    safe.user = saved?.user ? { id: (saved.user as any).id } : { id: userId };
    return safe as any;
  }
  // Create a new persona (does not replace existing ones)
  async createPersona(userId: number, payload: Partial<AutoReplySalesPersona>) {
    const toSave = this.personaRepo.create({
      name: payload.name!,
      personaPrompt: payload.personaPrompt!,
      user: { id: userId } as any,
    } as Partial<AutoReplySalesPersona>) as AutoReplySalesPersona;
    const savedRaw = await this.personaRepo.save(toSave);
    const saved = await this.personaRepo.findOne({
      where: { personaId: savedRaw.personaId },
      relations: ['user'],
    });
    this.ws.emitToUser(String(userId), 'autoReply:personaCreated', {
      personaId: savedRaw.personaId,
    });
    const safe = { ...(saved as any) };
    safe.user = saved?.user ? { id: (saved.user as any).id } : { id: userId };
    return safe as any;
  }
  async updatePersonaById(
    personaId: number,
    payload: Partial<AutoReplySalesPersona>,
    userId?: number,
  ) {
    const persona = await this.personaRepo.findOne({
      where: { personaId },
      relations: ['user'],
    });
    if (!persona) return null;
    Object.assign(persona, payload);
    // Ensure association if missing and userId provided
    if (!persona.user && userId) (persona as any).user = { id: userId } as any;
    const savedRaw = await this.personaRepo.save(persona);
    const saved = await this.personaRepo.findOne({
      where: { personaId: savedRaw.personaId },
      relations: ['user'],
    });
    if (userId)
      this.ws.emitToUser(String(userId), 'autoReply:personaUpdated', {
        personaId: savedRaw.personaId,
      });
    else
      this.ws.emitToAll('autoReply:personaUpdated', {
        personaId: savedRaw.personaId,
      });
    const safe = { ...(saved as any) };
    safe.user = saved?.user
      ? { id: (saved.user as any).id }
      : userId
        ? { id: userId }
        : undefined;
    return safe as any;
  }
  
  async deletePersona(personaId: number, userId: number) {
    // Optional: verify ownership
    const persona = await this.personaRepo.findOne({
      where: { personaId },
      relations: ['user'],
    });
    if (!persona) return { success: true, deleted: 0 } as any;
    // Null out assignedPersona for contacts using this persona first to avoid FK constraint
    await this.contactRepo
      .createQueryBuilder()
      .update()
      .set({ assignedPersona: null as any })
      .where('assigned_persona_id = :pid', { pid: personaId })
      .execute();

    await this.personaRepo.delete({ personaId });
    this.ws.emitToUser(String(userId), 'autoReply:personaDeleted', {
      personaId,
    });
    return { success: true, deleted: 1 } as any;
  }

  // Contacts
  async listContacts() {
    return this.contactRepo.find({
      order: { updatedAt: 'DESC' },
      relations: ['assignedPersona'],
    });
  }

  async listContactsForUser(userId: number, includeRestricted = false) {
    const qb = this.contactRepo
      .createQueryBuilder('c')
      .leftJoin('c.user', 'u')
      .where('u.id = :userId', { userId })
      .orderBy('c.updatedAt', 'DESC');
    if (!includeRestricted) {
      qb.andWhere('c.role NOT IN (:...roles)', {
        roles: [ContactRole.SUPPLIER, ContactRole.INTERNAL],
      });
    }
    return qb.getMany();
  }

  // New method for admin to see all contacts
  async listAllContacts(includeRestricted = false) {
    const qb = this.contactRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.user', 'u')
      .leftJoinAndSelect('c.assignedPersona', 'p')
      .orderBy('c.updatedAt', 'DESC');
    if (!includeRestricted) {
      qb.andWhere('c.role NOT IN (:...roles)', {
        roles: [ContactRole.SUPPLIER, ContactRole.INTERNAL],
      });
    }
    return qb.getMany();
  }

  async listContactsPaginated(opts: {
    userId?: number;
    mine?: boolean;
    page?: number;
    limit?: number;
    search?: string;
    excludeRoles?: string[];
    isAdmin?: boolean;
  }) {
    const { userId, mine, page = 1, limit = 50, search, excludeRoles, isAdmin = false } = opts || {};
    const qb = this.contactRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.assignedPersona', 'p')
      .leftJoinAndSelect('c.user', 'u') // Always include user info for admin
      .orderBy('c.updatedAt', 'DESC');

    // Admin sees all contacts, regular users see only their own
    if (!isAdmin && mine && userId) {
      qb.andWhere('u.id = :userId', { userId });
    }
    
    // Exclude restricted roles by default from selections; allow override via excludeRoles param
    const rolesToExclude = excludeRoles && excludeRoles.length
      ? excludeRoles
      : [ContactRole.SUPPLIER, ContactRole.INTERNAL];
    qb.andWhere('c.role NOT IN (:...roles)', { roles: rolesToExclude });
    if (search) {
      qb.andWhere('c.name LIKE :q', { q: `%${search}%` });
    }

    const [items, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { items, total, page, limit };
  }

  async updateContactRole(contactId: number, role: any) {
    await this.contactRepo.update({ contactId }, { role });
    const updated = await this.contactRepo.findOne({ where: { contactId } });
    this.ws.emitToAll('autoReply:contactUpdated', {
      contactId,
      patch: { role },
    });
    return updated;
  }

  async toggleContactAutoReply(contactId: number, enabled: boolean) {
    const updateData: any = { autoReplyOn: enabled };
    
    if (enabled) {
      updateData.autoReplyEnabledAt = new Date();
      updateData.autoReplyDisabledAt = null;
    } else {
      updateData.autoReplyDisabledAt = new Date();
    }
    
    await this.contactRepo.update({ contactId }, updateData);
    const updated = await this.contactRepo.findOne({ where: { contactId } });
    this.ws.emitToAll('autoReply:contactUpdated', {
      contactId,
      patch: { 
        autoReplyOn: enabled,
        autoReplyEnabledAt: updateData.autoReplyEnabledAt,
        autoReplyDisabledAt: updateData.autoReplyDisabledAt
      },
    });
    return updated;
  }

  async bulkToggleAutoReply(
    contactIds: number[] | 'ALL',
    enabled: boolean,
    userId?: number,
  ) {
    const qb = this.contactRepo
      .createQueryBuilder('c')
      .select('c.contact_id', 'contactId');
    if (contactIds !== 'ALL' && Array.isArray(contactIds) && contactIds.length) {
      qb.where('c.contact_id IN (:...ids)', { ids: contactIds });
    }
    if (userId !== undefined && userId !== null) {
      qb.andWhere('c.user_id = :uid', { uid: userId });
    }
    const rows = await qb.getRawMany<{ contactId: number }>();
    const targets = rows.map((r) => Number(r.contactId));
    if (targets.length) {
      const updateData: any = { autoReplyOn: enabled };
      
      if (enabled) {
        updateData.autoReplyEnabledAt = new Date();
        updateData.autoReplyDisabledAt = null;
      } else {
        updateData.autoReplyDisabledAt = new Date();
      }
      
      await this.contactRepo
        .createQueryBuilder()
        .update()
        .set(updateData)
        .whereInIds(targets)
        .execute();
      this.ws.emitToAll('autoReply:contactsBulkUpdated', {
        contactIds: targets,
        patch: { 
          autoReplyOn: enabled,
          autoReplyEnabledAt: updateData.autoReplyEnabledAt,
          autoReplyDisabledAt: updateData.autoReplyDisabledAt
        },
      });
    }
    return { success: true, count: targets.length };
  }

  async assignPersona(contactId: number, personaId: number | null) {
    const patch: any = {
      assignedPersona: personaId ? ({ personaId } as any) : null,
    };
    await this.contactRepo.update({ contactId }, patch);
    const updated = await this.contactRepo.findOne({
      where: { contactId },
      relations: ['assignedPersona'],
    });
    this.ws.emitToAll('autoReply:contactUpdated', {
      contactId,
      patch: { assignedPersonaId: personaId },
    });
    return updated;
  }

  async assignPersonaBulk(
    contactIds: number[] | 'ALL',
    personaId: number | null,
    userId?: number,
  ) {
    const qb = this.contactRepo
      .createQueryBuilder('c')
      .select('c.contact_id', 'contactId');
    if (contactIds !== 'ALL' && Array.isArray(contactIds) && contactIds.length) {
      qb.where('c.contact_id IN (:...ids)', { ids: contactIds });
    }
    if (userId !== undefined && userId !== null) {
      qb.andWhere('c.user_id = :uid', { uid: userId });
    }
    const rows = await qb.getRawMany<{ contactId: number }>();
    const targets = rows.map((r) => Number(r.contactId));
    for (const cid of targets) await this.assignPersona(cid, personaId);
    this.ws.emitToAll('autoReply:contactsBulkUpdated', {
      contactIds: targets,
      patch: { assignedPersonaId: personaId },
    });
    return { success: true, count: targets.length };
  }

  // Settings (global toggle mirrors per-contact flags)
  async getGlobalAutoReplySetting() {
    const total = await this.contactRepo.count();
    if (total === 0) return { enabled: false, total, enabledCount: 0 };
    const enabledCount = await this.contactRepo.count({
      where: { autoReplyOn: true as any },
    });
    const enabled = enabledCount === total;
    return { enabled, total, enabledCount };
  }
  async setGlobalAutoReplySetting(enabled: boolean) {
    await this.bulkToggleAutoReply('ALL', enabled);
    return this.getGlobalAutoReplySetting();
  }

  // Products
  async listProducts() {
    return this.productRepo.find();
  }

  async listProductsByIds(ids: number[]) {
    if (!Array.isArray(ids) || ids.length === 0) return [] as any;
    return this.productRepo
      .createQueryBuilder('p')
      .where('p.product_id IN (:...ids)', { ids })
      .getMany();
  }

  async listProductsPaginated(opts: {
    page?: number;
    limit?: number;
    search?: string;
    brands?: string[];
    cates?: string[];
    allowedForUserId?: number;
    prioritizeContactId?: number;
    activeForContactId?: number;
  }) {
    const {
      page = 1,
      limit = 20,
      search,
      brands,
      cates,
      allowedForUserId,
      prioritizeContactId,
      activeForContactId,
    } = opts || {};
    const qb = this.productRepo
      .createQueryBuilder('p')
      .leftJoin('p.priceTiers', 'pt', 'pt.deletedAt IS NULL')
      .addSelect([
        'pt.priceTierId',
        'pt.minQuantity',
        'pt.pricePerUnit'
      ])
      .orderBy('p.updatedAt', 'DESC');
    if (search) {
      qb.andWhere('(p.code LIKE :q OR p.name LIKE :q)', { q: `%${search}%` });
    }
    if (brands && brands.length) {
      qb.andWhere('p.brand IN (:...brands)', { brands });
    }
    if (cates && cates.length) {
      qb.andWhere('p.cate IN (:...cates)', { cates });
    }

    if (allowedForUserId) {
      // Only products that are allowed (active) for any contact of the current user
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM auto_reply_contact_allowed_products cap
          JOIN auto_reply_contacts c ON c.contact_id = cap.contact_id
          WHERE cap.product_id = p.product_id
            AND cap.active = TRUE
            AND c.user_id = :uid
        )`,
        { uid: allowedForUserId },
      );
    }
    // Only products active for a specific contact
    if (activeForContactId) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM auto_reply_contact_allowed_products cap3
          WHERE cap3.product_id = p.product_id
            AND cap3.contact_id = :afcid
            AND cap3.active = TRUE
        )`,
        { afcid: activeForContactId },
      );
    }
    // Prioritize products already active for a specific contactId at the top
    if (prioritizeContactId) {
      qb.addSelect(
        `CASE WHEN EXISTS (
            SELECT 1 FROM auto_reply_contact_allowed_products cap2
            WHERE cap2.product_id = p.product_id
              AND cap2.contact_id = :pcid
              AND cap2.active = TRUE
          ) THEN 1 ELSE 0 END`,
        'priority_score'
      );
      qb.orderBy('priority_score', 'DESC')
        .addOrderBy('p.updatedAt', 'DESC');
      qb.setParameter('pcid', prioritizeContactId);
    }
    const [items, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    // Transform data to include price info
    const transformedItems = items.map((product: any) => {
      const priceTiers = product.priceTiers || [];
      const minPriceTier = priceTiers.find((pt: any) => pt.minQuantity === 1) || priceTiers[0];
      
      return {
        ...product,
        minPrice: minPriceTier ? parseFloat(minPriceTier.pricePerUnit) : null,
        minQuantity: minPriceTier ? minPriceTier.minQuantity : null,
        stock: product.stock || 0,
        priceTiers: priceTiers.map((pt: any) => ({
          priceTierId: pt.priceTierId,
          minQuantity: pt.minQuantity,
          pricePerUnit: parseFloat(pt.pricePerUnit)
        }))
      };
    });

    if (prioritizeContactId) {
      const rows = await this.capRepo
        .createQueryBuilder('cap')
        .select('cap.product_id', 'productId')
        .where('cap.contact_id = :cid', { cid: prioritizeContactId })
        .andWhere('cap.active = :active', { active: true })
        .getRawMany<{ productId: number }>();
      const activeSet = new Set<number>(rows.map((r) => Number(r.productId)));
      const annotated = transformedItems.map((p: any) => ({
        ...p,
        activeForContact: activeSet.has(Number(p.productId)),
      }));
      return { items: annotated, total, page, limit } as any;
    }
    return { items: transformedItems, total, page, limit };
  }

  async listProductIds(opts: {
    search?: string;
    brands?: string[];
    cates?: string[];
    allowedForUserId?: number;
    activeForContactId?: number;
  }) {
    const {
      search,
      brands,
      cates,
      allowedForUserId,
      activeForContactId,
    } = opts || {};

    const qb = this.productRepo
      .createQueryBuilder('p')
      .select('p.product_id', 'productId');

    if (search) {
      qb.andWhere('(p.code LIKE :q OR p.name LIKE :q)', { q: `%${search}%` });
    }
    if (brands && brands.length) {
      qb.andWhere('p.brand IN (:...brands)', { brands });
    }
    if (cates && cates.length) {
      qb.andWhere('p.cate IN (:...cates)', { cates });
    }
    if (allowedForUserId) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM auto_reply_contact_allowed_products cap
          JOIN auto_reply_contacts c ON c.contact_id = cap.contact_id
          WHERE cap.product_id = p.product_id
            AND cap.active = TRUE
            AND c.user_id = :uid
        )`,
        { uid: allowedForUserId },
      );
    }
    if (activeForContactId) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM auto_reply_contact_allowed_products cap3
          WHERE cap3.product_id = p.product_id
            AND cap3.contact_id = :afcid
            AND cap3.active = TRUE
        )`,
        { afcid: activeForContactId },
      );
    }

    const rows = await qb.getRawMany<{ productId: number }>();
    return rows.map((r) => Number(r.productId));
  }

  async getProductsMeta() {
    const brandRows = await this.productRepo
      .createQueryBuilder('p')
      .select('DISTINCT p.brand', 'brand')
      .where("p.brand IS NOT NULL AND p.brand <> ''")
      .orderBy('p.brand', 'ASC')
      .getRawMany<{ brand: string }>();
    const cateRows = await this.productRepo
      .createQueryBuilder('p')
      .select('DISTINCT p.cate', 'cate')
      .where("p.cate IS NOT NULL AND p.cate <> ''")
      .orderBy('p.cate', 'ASC')
      .getRawMany<{ cate: string }>();
    return {
      brands: brandRows.map((r) => r.brand),
      cates: cateRows.map((r) => r.cate),
    };
  }

  async previewProductsFromExcel(fileBuffer: Buffer) {
    // Validate file size (max 10MB)
    if (fileBuffer.length > 10 * 1024 * 1024) {
      return {
        total: 0,
        data: [],
        errors: ['File quá lớn. Kích thước tối đa là 10MB'],
      };
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(fileBuffer as any);
    } catch (error) {
      return {
        total: 0,
        data: [],
        errors: ['File Excel không hợp lệ hoặc bị hỏng'],
      };
    }

    const sheet = workbook.worksheets[0];
    if (!sheet)
      return {
        total: 0,
        data: [],
        errors: ['Không tìm thấy worksheet trong file Excel'],
      };

    // Detect header row by finding a row that contains all required headers
    const requiredHeaders = ['MaHH', 'TenHH', 'NhanHang', 'NhomHang'];
    let headerRowIdx = 1;
    let headerMap: Record<string, number> = {};
    for (let i = 1; i <= Math.min(sheet.rowCount, 10); i++) {
      const row = sheet.getRow(i);
      const values = row.values as any[];
      const map: Record<string, number> = {};
      for (let c = 1; c < values.length; c++) {
        const v = (values[c] ?? '').toString().trim();
        if (v) map[v] = c;
      }
      if (requiredHeaders.every((h) => map[h] !== undefined)) {
        headerRowIdx = i;
        headerMap = map;
        break;
      }
    }
    if (!headerMap['MaHH']) {
      return {
        total: 0,
        data: [],
        errors: ['Không tìm thấy header cần thiết. Vui lòng kiểm tra file mẫu để biết format đúng'],
      };
    }

    // Validate minimum rows
    if (sheet.rowCount < 2) {
      return {
        total: 0,
        data: [],
        errors: ['File không có dữ liệu. Cần ít nhất 1 dòng dữ liệu'],
      };
    }

    const data: any[] = [];
    const errors: string[] = [];
    let totalValidRows = 0;
    let totalRows = 0;

    // Find the actual last row with data (not just sheet.rowCount which may include empty rows)
    let actualLastRow = headerRowIdx;
    for (let r = headerRowIdx + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const code = String(row.getCell(headerMap['MaHH']).value ?? '').trim();
      if (code) {
        actualLastRow = r;
      }
    }

    // First pass: count total valid rows in the entire file
    for (let r = headerRowIdx + 1; r <= actualLastRow; r++) {
      const row = sheet.getRow(r);
      const code = String(row.getCell(headerMap['MaHH']).value ?? '').trim();
      if (!code) continue;
      
      totalRows++;
      
      const name = String(row.getCell(headerMap['TenHH']).value ?? '').trim();
      const brand = String(
        row.getCell(headerMap['NhanHang']).value ?? '',
      ).trim();
      const cate = String(
        row.getCell(headerMap['NhomHang']).value ?? '',
      ).trim();

      // Validate required fields
      const rowErrors: string[] = [];
      if (!name) rowErrors.push('Tên sản phẩm không được để trống');
      if (!brand) rowErrors.push('Thương hiệu không được để trống');
      if (!cate) rowErrors.push('Danh mục không được để trống');
      if (code.length > 100) rowErrors.push('Mã sản phẩm quá dài (tối đa 100 ký tự)');
      if (name.length > 255) rowErrors.push('Tên sản phẩm quá dài (tối đa 255 ký tự)');

      if (rowErrors.length === 0) {
        totalValidRows++;
      }

      if (rowErrors.length > 0) {
        errors.push(`Dòng ${r}: ${rowErrors.join(', ')}`);
      }
    }

    // Second pass: collect preview data (all rows)
    for (let r = headerRowIdx + 1; r <= actualLastRow; r++) {
      const row = sheet.getRow(r);
      const code = String(row.getCell(headerMap['MaHH']).value ?? '').trim();
      if (!code) continue;
      
      const name = String(row.getCell(headerMap['TenHH']).value ?? '').trim();
      const brand = String(
        row.getCell(headerMap['NhanHang']).value ?? '',
      ).trim();
      const cate = String(
        row.getCell(headerMap['NhomHang']).value ?? '',
      ).trim();

      // Validate required fields
      const rowErrors: string[] = [];
      if (!name) rowErrors.push('Tên sản phẩm không được để trống');
      if (!brand) rowErrors.push('Thương hiệu không được để trống');
      if (!cate) rowErrors.push('Danh mục không được để trống');
      if (code.length > 100) rowErrors.push('Mã sản phẩm quá dài (tối đa 100 ký tự)');
      if (name.length > 255) rowErrors.push('Tên sản phẩm quá dài (tối đa 255 ký tự)');

      data.push({
        row: r,
        code,
        name,
        brand,
        cate,
        errors: rowErrors,
        isValid: rowErrors.length === 0
      });
    }

    return {
      total: totalRows, // Total rows in file
      valid: totalValidRows, // Total valid rows
      preview: data.length, // Number of rows in preview
      data,
      errors
    };
  }

  async importProductsFromExcel(fileBuffer: Buffer) {
    // Validate file size (max 10MB)
    if (fileBuffer.length > 10 * 1024 * 1024) {
      return {
        total: 0,
        created: 0,
        updated: 0,
        errors: ['File quá lớn. Kích thước tối đa là 10MB'],
      };
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(fileBuffer as any);
    } catch (error) {
      return {
        total: 0,
        created: 0,
        updated: 0,
        errors: ['File Excel không hợp lệ hoặc bị hỏng'],
      };
    }

    const sheet = workbook.worksheets[0];
    if (!sheet)
      return {
        total: 0,
        created: 0,
        updated: 0,
        errors: ['Không tìm thấy worksheet trong file Excel'],
      };

    // Detect header row by finding a row that contains all required headers
    const requiredHeaders = ['MaHH', 'TenHH', 'NhanHang', 'NhomHang'];
    let headerRowIdx = 1;
    let headerMap: Record<string, number> = {};
    for (let i = 1; i <= Math.min(sheet.rowCount, 10); i++) {
      const row = sheet.getRow(i);
      const values = row.values as any[];
      const map: Record<string, number> = {};
      for (let c = 1; c < values.length; c++) {
        const v = (values[c] ?? '').toString().trim();
        if (v) map[v] = c;
      }
      if (requiredHeaders.every((h) => map[h] !== undefined)) {
        headerRowIdx = i;
        headerMap = map;
        break;
      }
    }
    if (!headerMap['MaHH']) {
      return {
        total: 0,
        created: 0,
        updated: 0,
        errors: ['Không tìm thấy header cần thiết. Vui lòng kiểm tra file mẫu để biết format đúng'],
      };
    }

    // Find the actual last row with data (not just sheet.rowCount which may include empty rows)
    let actualLastRow = headerRowIdx;
    for (let r = headerRowIdx + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const code = String(row.getCell(headerMap['MaHH']).value ?? '').trim();
      if (code) {
        actualLastRow = r;
      }
    }

    // Validate minimum rows
    if (actualLastRow <= headerRowIdx) {
      return {
        total: 0,
        created: 0,
        updated: 0,
        errors: ['File không có dữ liệu. Cần ít nhất 1 dòng dữ liệu'],
      };
    }

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (let r = headerRowIdx + 1; r <= actualLastRow; r++) {
      const row = sheet.getRow(r);
      const code = String(row.getCell(headerMap['MaHH']).value ?? '').trim();
      if (!code) continue;
      
      const name = String(row.getCell(headerMap['TenHH']).value ?? '').trim();
      const brand = String(
        row.getCell(headerMap['NhanHang']).value ?? '',
      ).trim();
      const cate = String(
        row.getCell(headerMap['NhomHang']).value ?? '',
      ).trim();

      // Validate required fields
      if (!name) {
        errors.push(`Dòng ${r}: Tên sản phẩm không được để trống`);
        continue;
      }
      if (!brand) {
        errors.push(`Dòng ${r}: Thương hiệu không được để trống`);
        continue;
      }
      if (!cate) {
        errors.push(`Dòng ${r}: Danh mục không được để trống`);
        continue;
      }
      if (code.length > 100) {
        errors.push(`Dòng ${r}: Mã sản phẩm quá dài (tối đa 100 ký tự)`);
        continue;
      }
      if (name.length > 255) {
        errors.push(`Dòng ${r}: Tên sản phẩm quá dài (tối đa 255 ký tự)`);
        continue;
      }

      try {
        let product = await this.productRepo.findOne({ where: { code } });
        if (!product) {
          product = this.productRepo.create({
            code,
            name,
            brand,
            cate,
            stock: 0,
          });
          created++;
        } else {
          product.name = name || product.name;
          product.brand = brand || product.brand;
          product.cate = cate || product.cate;
          updated++;
        }

        // Enrich attrs from NKC if exact match
        const nkc = await this.nkcRepo.findOne({
          where: { productCode: code },
        });
        if (nkc && nkc.properties !== undefined) {
          (product as any).attrs = nkc.properties as any;
        }

        await this.productRepo.save(product);
      } catch (e: any) {
        errors.push(`Row ${r}: ${e?.message || 'unknown error'}`);
      }
    }

    // Notify clients
    this.ws.emitToAll('autoReply:productsImported', { created, updated });

    return { total: created + updated, created, updated, errors };
  }
  async getAllowedProducts(contactId: number) {
    return this.capRepo.find({ where: { contactId } });
  }
  async patchAllowedProducts(
    contactId: number,
    productIds: number[],
    active: boolean,
    userId?: number,
  ) {
    // Get department_slug from user's main department
    const departmentSlug = userId ? await this.getUserMainDepartmentSlug(userId) : null;
    
    console.log(`[DEBUG] patchAllowedProducts - contactId: ${contactId}, userId: ${userId}, departmentSlug: ${departmentSlug}`);
    
    const existing = await this.capRepo.find({ where: { contactId } });
    const map = new Map(existing.map((e) => [e.productId, e]));
    for (const pid of productIds) {
      if (map.has(pid)) {
        const rec = map.get(pid)!;
        rec.active = active;
        rec.department_slug = departmentSlug;
        console.log(`[DEBUG] Updating existing record - contactId: ${contactId}, productId: ${pid}, department_slug: ${departmentSlug}`);
        await this.capRepo.save(rec);
      } else {
        const newRecord = this.capRepo.create({ 
          contactId, 
          productId: pid, 
          active, 
          department_slug: departmentSlug 
        });
        console.log(`[DEBUG] Creating new record - contactId: ${contactId}, productId: ${pid}, department_slug: ${departmentSlug}`);
        await this.capRepo.save(newRecord);
      }
    }
    const res = await this.getAllowedProducts(contactId);
    this.ws.emitToAll('autoReply:allowedProductsUpdated', { contactId });
    return res;
  }
  async bulkAllowedProducts(
    contactIds: number[] | 'ALL',
    productIds: number[],
    active: boolean,
    userId?: number,
  ) {
    // Build target contact list scoped by userId when provided
    const qb = this.contactRepo
      .createQueryBuilder('c')
      .select('c.contact_id', 'contactId');
    if (contactIds !== 'ALL' && Array.isArray(contactIds) && contactIds.length) {
      qb.where('c.contact_id IN (:...ids)', { ids: contactIds });
    }
    if (userId !== undefined && userId !== null) {
      qb.andWhere('c.user_id = :uid', { uid: userId });
    }
    // Exclude restricted roles (supplier/internal)
    qb.andWhere('c.role NOT IN (:...roles)', {
      roles: [ContactRole.SUPPLIER, ContactRole.INTERNAL],
    });
    const rows = await qb.getRawMany<{ contactId: number }>();
    const targets = rows.map((r) => Number(r.contactId));
    if (targets.length === 0) {
      return { success: true, count: 0 };
    }
    for (const cid of targets) {
      await this.patchAllowedProducts(cid, productIds, active, userId);
    }
    this.ws.emitToAll('autoReply:allowedProductsBulkUpdated', {
      contactIds: targets,
    });
    return { success: true, count: targets.length };
  }

  // List all active allowed (contactId, productId) pairs for contacts owned by a user
  async listMyAllowedProducts(userId: number) {
    if (userId === undefined || userId === null) {
      throw new Error('Missing userId');
    }

    const rows = await this.capRepo
      .createQueryBuilder('cap')
      .innerJoin(AutoReplyContact, 'c', 'c.contact_id = cap.contact_id')
      .where('c.user_id = :uid', { uid: userId })
      .andWhere('c.role NOT IN (:...roles)', {
        roles: [ContactRole.SUPPLIER, ContactRole.INTERNAL],
      })
      .andWhere('cap.active = :active', { active: true })
      .select(['cap.contact_id AS contactId', 'cap.product_id AS productId'])
      .orderBy('cap.contact_id', 'ASC')
      .addOrderBy('cap.product_id', 'ASC')
      .getRawMany<{ contactId: number; productId: number }>();

    return rows;
  }

  // Keyword routes
  async listKeywordRoutes(contactId?: number | null) {
    if (contactId === undefined) {
      return this.routeRepo.find({ relations: ['routeProducts', 'contact'] });
    }
    if (contactId === null) {
      // No more global (null) routes; return empty list
      return [] as any;
    }
    return this.routeRepo.find({
      where: { contactId },
      relations: ['routeProducts', 'contact'],
    });
  }

  // Bulk keyword operations scoped to a user's contacts
  async renameKeywordForUser(oldKeyword: string, newKeyword: string, userId: number) {
    // Find all routes for the user's contacts with the old keyword
    const routes = await this.routeRepo
      .createQueryBuilder('r')
      .innerJoin(AutoReplyContact, 'c', 'c.contact_id = r.contact_id')
      .leftJoinAndSelect('r.routeProducts', 'rp')
      .where('c.user_id = :uid', { uid: userId })
      .andWhere('r.keyword = :kw', { kw: oldKeyword })
      .getMany();

    let updated = 0;
    for (const route of routes) {
      // Check if a route with newKeyword already exists for this contact
      let existingNew = await this.routeRepo.findOne({
        where: { keyword: newKeyword, contactId: route.contactId as any },
        relations: ['routeProducts'],
      });
      if (!existingNew) {
        // Just update keyword
        await this.routeRepo.update({ routeId: route.routeId }, { keyword: newKeyword } as any);
        updated++;
      } else {
        // Merge products from old into new, then delete old
        const existingIds = new Set<number>((existingNew.routeProducts || []).map((p: any) => Number(p.productId)));
        for (const rp of route.routeProducts || []) {
          if (!existingIds.has(Number(rp.productId))) {
            await this.rpRepo.save(
              this.rpRepo.create({
                routeId: existingNew.routeId,
                productId: rp.productId,
                priority: rp.priority ?? 0,
                active: rp.active ?? true,
              } as any),
            );
          }
        }
        await this.routeRepo.delete({ routeId: route.routeId });
        updated++;
      }
    }
    this.ws.emitToUser(String(userId), 'autoReply:keywordRoutesChanged', {
      action: 'renameAll',
      oldKeyword,
      newKeyword,
      updated,
    });
    return { success: true, updated } as any;
  }

  async setKeywordActiveForUser(keyword: string, active: boolean, userId: number) {
    // Update active flag for all routes with keyword under user's contacts
    const qb = this.routeRepo
      .createQueryBuilder()
      .update()
      .set({ active: !!active } as any)
      .where('keyword = :kw', { kw: keyword })
      .andWhere(
        `contact_id IN (SELECT c.contact_id FROM auto_reply_contacts c WHERE c.user_id = :uid)`,
        { uid: userId },
      );
    const res = await qb.execute();
    const affected = (res as any)?.affected ?? 0;
    this.ws.emitToUser(String(userId), 'autoReply:keywordRoutesChanged', {
      action: 'setActiveAll',
      keyword,
      active: !!active,
      affected,
    });
    return { success: true, affected } as any;
  }

  async reorderProductsForKeyword(keyword: string, productIds: number[], userId: number) {
    // Get routes for this keyword under user's contacts
    const routes = await this.routeRepo
      .createQueryBuilder('r')
      .innerJoin(AutoReplyContact, 'c', 'c.contact_id = r.contact_id')
      .leftJoinAndSelect('r.routeProducts', 'rp')
      .where('c.user_id = :uid', { uid: userId })
      .andWhere('r.keyword = :kw', { kw: keyword })
      .getMany();
    let updated = 0;
    for (const route of routes) {
    // Use 1-based priorities consistently
    const orderMap = new Map<number, number>();
    productIds.forEach((pid, idx) => orderMap.set(Number(pid), idx + 1));
    const base = productIds.length + 1;
      for (const rp of route.routeProducts || []) {
        const pid = Number(rp.productId);
        if (orderMap.has(pid)) {
          const newPrio = orderMap.get(pid)!;
          if (rp.priority !== newPrio) {
            await this.rpRepo.update({ id: rp.id }, { priority: newPrio } as any);
            updated++;
          }
        } else {
          // Push others after provided list, keep relative order by offsetting existing priority
      const newPrio = base + (rp.priority ?? 0);
          if (rp.priority !== newPrio) {
            await this.rpRepo.update({ id: rp.id }, { priority: newPrio } as any);
            updated++;
          }
        }
      }
    }
    this.ws.emitToUser(String(userId), 'autoReply:keywordRoutesChanged', {
      action: 'reorderProducts',
      keyword,
      updated,
    });
    return { success: true, updated } as any;
  }

  async deleteKeywordForUser(keyword: string, userId: number) {
    // Delete all routes with keyword for this user
    const routes = await this.routeRepo
      .createQueryBuilder('r')
      .innerJoin(AutoReplyContact, 'c', 'c.contact_id = r.contact_id')
      .where('c.user_id = :uid', { uid: userId })
      .andWhere('r.keyword = :kw', { kw: keyword })
      .select(['r.route_id AS routeId'])
      .getRawMany<{ routeId: number }>();
    const ids = routes.map((r) => Number(r.routeId));
    if (ids.length) {
      await this.routeRepo.delete(ids as any);
    }
    this.ws.emitToUser(String(userId), 'autoReply:keywordRoutesChanged', {
      action: 'deleteAll',
      keyword,
      deleted: ids.length,
    });
    return { success: true, deleted: ids.length } as any;
  }

  // Add or remove products for all routes of a keyword under a user
  async addProductsToKeyword(keyword: string, productIds: number[], userId: number) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return { success: true, added: 0 } as any;
    }
    const routes = await this.routeRepo
      .createQueryBuilder('r')
      .innerJoin(AutoReplyContact, 'c', 'c.contact_id = r.contact_id')
      .leftJoinAndSelect('r.routeProducts', 'rp')
      .where('c.user_id = :uid', { uid: userId })
      .andWhere('r.keyword = :kw', { kw: keyword })
      .getMany();
    let added = 0;
    for (const route of routes) {
      const existingIds = new Set<number>((route.routeProducts || []).map((p: any) => Number(p.productId)));
      // Determine append start priority
      const maxPrio = (route.routeProducts || []).reduce((m: number, p: any) => Math.max(m, Number(p.priority ?? 0)), 0);
      let offset = 1;
      const addedForThisRoute: number[] = [];
      for (const pidRaw of productIds) {
        const pid = Number(pidRaw);
        if (!existingIds.has(pid)) {
          await this.rpRepo.save(
            this.rpRepo.create({
              routeId: (route as any).routeId,
              productId: pid,
              priority: maxPrio + offset,
              active: true,
            } as any),
          );
          offset++;
          added++;
          addedForThisRoute.push(pid);
        }
      }
      // Ensure allowed-products reflect these selections for this contact
      const ensureIds = addedForThisRoute.length ? addedForThisRoute : productIds.map(Number);
      if (ensureIds.length) {
        try {
          await this.patchAllowedProducts(route.contactId as any, ensureIds, true, userId);
        } catch (_) {}
      }
    }
    this.ws.emitToUser(String(userId), 'autoReply:keywordRoutesChanged', {
      action: 'addProductsAll',
      keyword,
      count: added,
    });
    return { success: true, added } as any;
  }

  async removeProductsFromKeyword(keyword: string, productIds: number[], userId: number) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return { success: true, removed: 0 } as any;
    }
    // Find route ids for this user+keyword
    const routes = await this.routeRepo
      .createQueryBuilder('r')
      .innerJoin(AutoReplyContact, 'c', 'c.contact_id = r.contact_id')
      .where('c.user_id = :uid', { uid: userId })
      .andWhere('r.keyword = :kw', { kw: keyword })
      .select(['r.route_id AS routeId'])
      .getRawMany<{ routeId: number }>();
    const routeIds = routes.map((r) => Number(r.routeId));
    if (!routeIds.length) return { success: true, removed: 0 } as any;
    const res = await this.rpRepo
      .createQueryBuilder()
      .delete()
      .where('route_id IN (:...rids)', { rids: routeIds })
      .andWhere('product_id IN (:...pids)', { pids: productIds })
      .execute();
    const removed = (res as any)?.affected ?? 0;
    this.ws.emitToUser(String(userId), 'autoReply:keywordRoutesChanged', {
      action: 'removeProductsAll',
      keyword,
      count: removed,
    });
    return { success: true, removed } as any;
  }

  async setProductsForKeyword(keyword: string, productIds: number[], userId: number) {
    // Replace the product set for all routes of this keyword for the user
    // Strategy: For each route, compute additions and deletions relative to current, then apply
    const routes = await this.routeRepo
      .createQueryBuilder('r')
      .innerJoin(AutoReplyContact, 'c', 'c.contact_id = r.contact_id')
      .leftJoinAndSelect('r.routeProducts', 'rp')
      .where('c.user_id = :uid', { uid: userId })
      .andWhere('r.keyword = :kw', { kw: keyword })
      .getMany();
    let added = 0;
    let removed = 0;
    const targetSet = new Set<number>((productIds || []).map((x) => Number(x)));
    for (const route of routes) {
      const current = new Set<number>((route.routeProducts || []).map((p: any) => Number(p.productId)));
      const toAdd = Array.from(targetSet).filter((x) => !current.has(x));
      const toRemove = Array.from(current).filter((x) => !targetSet.has(x));
      if (toAdd.length)
        added += (await this.addProductsToKeyword(keyword, toAdd, userId)).added;
      if (toRemove.length)
        removed += (await this.removeProductsFromKeyword(keyword, toRemove, userId)).removed;
    }
    this.ws.emitToUser(String(userId), 'autoReply:keywordRoutesChanged', {
      action: 'setProductsAll',
      keyword,
      added,
      removed,
    });
    return { success: true, added, removed } as any;
  }

  // Per-route product management (operate on a single contact's route)
  async addProductsToRoute(routeId: number, productIds: number[]) {
    const route = await this.routeRepo.findOne({ 
      where: { routeId }, 
      relations: ['routeProducts', 'contact', 'contact.user'] 
    });
    if (!route) return { success: true, added: 0 } as any;
    const existingIds = new Set<number>((route.routeProducts || []).map((p: any) => Number(p.productId)));
    const maxPrio = (route.routeProducts || []).reduce((m: number, p: any) => Math.max(m, Number(p.priority ?? 0)), 0);
    let offset = 1;
    let added = 0;
    const addedIds: number[] = [];
    for (const raw of productIds || []) {
      const pid = Number(raw);
      if (!existingIds.has(pid)) {
        await this.rpRepo.save(this.rpRepo.create({ routeId: route.routeId as any, productId: pid, priority: maxPrio + offset, active: true } as any));
        added++;
        offset++;
        addedIds.push(pid);
      }
    }
    // Ensure allowed-products sync
    try {
      if ((route as any).contactId && (addedIds.length || (productIds || []).length)) {
        const ensure = addedIds.length ? addedIds : (productIds || []).map(Number);
        const userId = (route as any).contact?.user?.id;
        await this.patchAllowedProducts((route as any).contactId, ensure, true, userId);
      }
    } catch (_) {}
    return { success: true, added } as any;
  }

  async removeProductsFromRoute(routeId: number, productIds: number[]) {
    const res = await this.rpRepo
      .createQueryBuilder()
      .delete()
      .where('route_id = :rid', { rid: routeId })
      .andWhere('product_id IN (:...pids)', { pids: productIds || [] })
      .execute();
    const removed = (res as any)?.affected ?? 0;
    return { success: true, removed } as any;
  }

  async setProductsForRoute(routeId: number, productIds: number[]) {
    const route = await this.routeRepo.findOne({ where: { routeId }, relations: ['routeProducts'] });
    if (!route) return { success: true, added: 0, removed: 0 } as any;
    // Normalize inputs and compute delta
    const normalized = (productIds || []).map((x) => Number(x)).filter((x, i, arr) => arr.indexOf(x) === i);
    const current = new Set<number>((route.routeProducts || []).map((p: any) => Number(p.productId)));
    const target = new Set<number>(normalized);
    const toAdd = Array.from(target).filter((x) => !current.has(x));
    const toRemove = Array.from(current).filter((x) => !target.has(x));
    let added = 0;
    let removed = 0;
    if (toAdd.length) added += (await this.addProductsToRoute(routeId, toAdd)).added;
    if (toRemove.length) removed += (await this.removeProductsFromRoute(routeId, toRemove)).removed;

    // Re-fetch routeProducts after mutations to ensure we have current IDs
    const refreshed = await this.routeRepo.findOne({ where: { routeId }, relations: ['routeProducts'] });
    const rpMap = new Map<number, any>();
    for (const rp of refreshed?.routeProducts || []) {
      rpMap.set(Number((rp as any).productId), rp);
    }
    // Persist priority exactly as the order in 'normalized' (1-based)
    for (let i = 0; i < normalized.length; i++) {
      const pid = normalized[i];
      const rp = rpMap.get(pid);
      const desired = i + 1;
      if (rp && Number(rp.priority ?? -1) !== desired) {
        await this.rpRepo.update({ id: (rp as any).id }, { priority: desired } as any);
      }
    }
    return { success: true, added, removed } as any;
  }

  async createKeywordRoute(
    keyword: string,
    contactId: number | null,
    routeProducts: { productId: number; priority?: number; active?: boolean }[],
    options?: { fanoutForUserId?: number },
  ) {
    // If contactId is null and fanout is requested, create one per contact for that user
    if (contactId == null && options?.fanoutForUserId) {
      // Include all roles for GLOBAL fanout per requirement
      const contacts = await this.listContactsForUser(options.fanoutForUserId, true);
      const createdRoutes = [] as AutoReplyKeywordRoute[];
      for (const c of contacts) {
        const r = await this.createKeywordRoute(
          keyword,
          c.contactId,
          routeProducts,
        );
        createdRoutes.push(r as any);
      }
      this.ws.emitToUser(String(options.fanoutForUserId), 'autoReply:keywordRoutesChanged', { scope: 'GLOBAL-FANOUT' });
      return createdRoutes;
    }

    // Disallow null contactId when not using fan-out
    if (contactId == null) {
      throw new Error('contactId is required (no global null). Use fan-out option instead.');
    }

    // If a route already exists for this (keyword, contactId), merge products
    let existing = await this.routeRepo.findOne({
      where: { keyword, contactId: contactId as any },
      relations: ['routeProducts'],
    });
    if (!existing) {
      const route = this.routeRepo.create({
        keyword,
        contactId: contactId as any,
        active: true,
      });
      existing = await this.routeRepo.save(route);
      existing = await this.routeRepo.findOne({
        where: { routeId: existing.routeId },
        relations: ['routeProducts'],
      }) as any;
    }
    const existingProductIds = new Set((existing?.routeProducts || []).map((rp: any) => Number(rp.productId)));
    for (const rp of routeProducts) {
      if (!existingProductIds.has(Number(rp.productId))) {
        await this.rpRepo.save(
          this.rpRepo.create({
            routeId: (existing as any).routeId,
            productId: rp.productId,
            priority: rp.priority ?? 0,
            active: rp.active ?? true,
          } as any),
        );
      }
    }
    const full = await this.routeRepo.findOne({
      where: { routeId: (existing as any).routeId },
      relations: ['routeProducts', 'contact', 'contact.user'],
    });
    // Ensure selected products for this keyword are also allowed for the contact
    try {
      const toAllow = Array.from(new Set((routeProducts || []).map((rp) => Number(rp.productId))));
      if ((contactId as any) && toAllow.length) {
        const userId = (full as any)?.contact?.user?.id;
        await this.patchAllowedProducts(contactId as any, toAllow, true, userId);
      }
    } catch (_) {}
    this.ws.emitToAll('autoReply:keywordRoutesChanged', {
      scope: contactId ?? 'GLOBAL',
    });
    return full;
  }
  async createKeywordRoutesBulk(
    keyword: string,
    contactIds: number[],
    productIds: number[],
    defaultPriority = 0,
    active = true,
  ) {
    // Filter out restricted roles to ensure we don't create routes for supplier/internal contacts
    const allowedContactRows = await this.contactRepo
      .createQueryBuilder('c')
      .select('c.contact_id', 'contactId')
      .where('c.contact_id IN (:...ids)', { ids: contactIds.length ? contactIds : [0] })
      .andWhere('c.role NOT IN (:...roles)', {
        roles: [ContactRole.SUPPLIER, ContactRole.INTERNAL],
      })
      .getRawMany<{ contactId: number }>();
    const allowedContactIds = allowedContactRows.map((r) => Number(r.contactId));
    const created = [] as any[];
    for (const cid of allowedContactIds) {
      const route = await this.createKeywordRoute(
        keyword,
        cid,
        productIds.map((pid) => ({
          productId: pid,
          priority: defaultPriority,
          active,
        })),
      );
      created.push(route);
    }
    this.ws.emitToAll('autoReply:keywordRoutesChanged', { scope: 'MULTI' });
    return created;
  }
  async updateKeywordRoute(
    routeId: number,
    patch: Partial<AutoReplyKeywordRoute> & {
      routeProducts?: AutoReplyRouteProduct[];
    },
  ) {
    await this.routeRepo.update({ routeId }, patch as any);
    if (patch.routeProducts) {
      for (const rp of patch.routeProducts) {
        if (rp.id) await this.rpRepo.update({ id: rp.id }, rp as any);
      }
    }
    const full = await this.routeRepo.findOne({
      where: { routeId },
      relations: ['routeProducts'],
    });
    this.ws.emitToAll('autoReply:keywordRoutesChanged', { routeId });
    return full;
  }
  async deleteKeywordRoute(routeId: number) {
    await this.routeRepo.delete({ routeId });
    this.ws.emitToAll('autoReply:keywordRoutesChanged', {
      routeId,
      deleted: true,
    });
    return { success: true };
  }

  // Profiles
  async getProfile(contactId: number) {
    return this.profileRepo.findOne({ where: { contactId } });
  }
  async patchProfile(
    contactId: number,
    patch: Partial<AutoReplyCustomerProfile>,
  ) {
    let p = await this.getProfile(contactId);
    if (!p)
      p = this.profileRepo.create({
        contactId,
        notes: '',
        toneHints: '',
        aovThreshold: null,
      });
    Object.assign(p, patch);
    const saved = await this.profileRepo.save(p);
    this.ws.emitToAll('autoReply:profileUpdated', { contactId });
    return saved;
  }

  // Conversations & messages
  async getConversationByContact(contactId: number) {
    return this.convRepo.findOne({ where: { contactId } });
  }
  async listMessages(convId: number, page = 1, pageSize = 50) {
    const [items, total] = await this.msgRepo.findAndCount({
      where: { convId },
      order: { createdAt: 'ASC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    });
    return { items, page, total };
  }

  // Rename + webhook
  async renameContact(contactId: number, newName: string) {
    await this.contactRepo.update({ contactId }, { name: newName });
    const updated = await this.contactRepo.findOne({ where: { contactId } });
    this.ws.emitToAll('autoReply:contactUpdated', {
      contactId,
      patch: { name: newName },
    });
    return updated;
  }
}
