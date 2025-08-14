import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AutoReplySalesPersona } from '../auto_reply_sales_personas/auto_reply_sales_persona.entity';
import { AutoReplyContact } from '../auto_reply_contacts/auto_reply_contact.entity';
import { AutoReplyCustomerProfile } from '../auto_reply_customer_profiles/auto_reply_customer_profile.entity';
import { AutoReplyProduct } from '../auto_reply_products/auto_reply_product.entity';
import { AutoReplyContactAllowedProduct } from '../auto_reply_contact_allowed_products/auto_reply_contact_allowed_product.entity';
import { AutoReplyKeywordRoute } from '../auto_reply_keyword_routes/auto_reply_keyword_route.entity';
import { AutoReplyRouteProduct } from '../auto_reply_products/auto_reply_route_product.entity';
import { AutoReplyConversation } from '../auto_reply_conversations/auto_reply_conversation.entity';
import { AutoReplyMessage } from '../auto_reply_messages/auto_reply_message.entity';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { NKCProduct } from '../nkc_products/nkc_product.entity';
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
    private readonly ws: WebsocketGateway,
  ) {}

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

  // Contacts
  async listContacts() {
    return this.contactRepo.find({
      order: { updatedAt: 'DESC' },
      relations: ['assignedPersona'],
    });
  }

  async listContactsForUser(userId: number) {
    return this.contactRepo
      .createQueryBuilder('c')
      .leftJoin('c.user', 'u')
      .where('u.id = :userId', { userId })
      .orderBy('c.updatedAt', 'DESC')
      .getMany();
  }

  async listContactsPaginated(opts: {
    userId?: number;
    mine?: boolean;
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const { userId, mine, page = 1, limit = 50, search } = opts || {};
    const qb = this.contactRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.assignedPersona', 'p')
      .leftJoin('c.user', 'u')
      .orderBy('c.updatedAt', 'DESC');

    if (mine && userId) qb.andWhere('u.id = :userId', { userId });
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
    await this.contactRepo.update({ contactId }, { autoReplyOn: enabled });
    const updated = await this.contactRepo.findOne({ where: { contactId } });
    this.ws.emitToAll('autoReply:contactUpdated', {
      contactId,
      patch: { autoReplyOn: enabled },
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
      await this.contactRepo
        .createQueryBuilder()
        .update()
        .set({ autoReplyOn: enabled })
        .whereInIds(targets)
        .execute();
      this.ws.emitToAll('autoReply:contactsBulkUpdated', {
        contactIds: targets,
        patch: { autoReplyOn: enabled },
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
      qb.orderBy(
        `CASE WHEN EXISTS (
            SELECT 1 FROM auto_reply_contact_allowed_products cap2
            WHERE cap2.product_id = p.product_id
              AND cap2.contact_id = :pcid
              AND cap2.active = TRUE
          ) THEN 1 ELSE 0 END`,
        'DESC',
      ).addOrderBy('p.updatedAt', 'DESC');
      qb.setParameter('pcid', prioritizeContactId);
    }
    const [items, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    if (prioritizeContactId) {
      const rows = await this.capRepo
        .createQueryBuilder('cap')
        .select('cap.product_id', 'productId')
        .where('cap.contact_id = :cid', { cid: prioritizeContactId })
        .andWhere('cap.active = :active', { active: true })
        .getRawMany<{ productId: number }>();
      const activeSet = new Set<number>(rows.map((r) => Number(r.productId)));
      const annotated = items.map((p: any) => ({
        ...(p as any),
        activeForContact: activeSet.has(Number((p as any).productId)),
      }));
      return { items: annotated, total, page, limit } as any;
    }
    return { items, total, page, limit };
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

  async importProductsFromExcel(fileBuffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer as any);

    const sheet = workbook.worksheets[0];
    if (!sheet)
      return {
        total: 0,
        created: 0,
        updated: 0,
        errors: ['No worksheet found'],
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
        errors: ['Headers not found: require MaHH, TenHH, NhanHang, NhomHang'],
      };
    }

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (let r = headerRowIdx + 1; r <= sheet.rowCount; r++) {
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
  ) {
    const existing = await this.capRepo.find({ where: { contactId } });
    const map = new Map(existing.map((e) => [e.productId, e]));
    for (const pid of productIds) {
      if (map.has(pid)) {
        const rec = map.get(pid)!;
        rec.active = active;
        await this.capRepo.save(rec);
      } else {
        await this.capRepo.save(
          this.capRepo.create({ contactId, productId: pid, active }),
        );
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
    const rows = await qb.getRawMany<{ contactId: number }>();
    const targets = rows.map((r) => Number(r.contactId));
    if (targets.length === 0) {
      return { success: true, count: 0 };
    }
    for (const cid of targets) {
      await this.patchAllowedProducts(cid, productIds, active);
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
      .andWhere('cap.active = :active', { active: true })
      .select(['cap.contact_id AS contactId', 'cap.product_id AS productId'])
      .orderBy('cap.contact_id', 'ASC')
      .addOrderBy('cap.product_id', 'ASC')
      .getRawMany<{ contactId: number; productId: number }>();

    return rows;
  }

  // Keyword routes
  async listKeywordRoutes(contactId?: number | null) {
    if (contactId === undefined)
      return this.routeRepo.find({ relations: ['routeProducts'] });
    if (contactId === null)
      return this.routeRepo.find({
        where: { contactId: null as any },
        relations: ['routeProducts'],
      });
    return this.routeRepo.find({
      where: [{ contactId }, { contactId: null as any }],
      relations: ['routeProducts'],
    });
  }
  async createKeywordRoute(
    keyword: string,
    contactId: number | null,
    routeProducts: { productId: number; priority?: number; active?: boolean }[],
  ) {
    const route = this.routeRepo.create({
      keyword,
      contactId: contactId as any,
      active: true,
    });
    const saved = await this.routeRepo.save(route);
    for (const rp of routeProducts) {
      await this.rpRepo.save(
        this.rpRepo.create({
          routeId: saved.routeId,
          productId: rp.productId,
          priority: rp.priority ?? 0,
          active: rp.active ?? true,
        } as any),
      );
    }
    const full = await this.routeRepo.findOne({
      where: { routeId: saved.routeId },
      relations: ['routeProducts'],
    });
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
    const created = [] as any[];
    for (const cid of contactIds) {
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
    const items = await this.msgRepo.find({
      where: { convId },
      order: { createdAt: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    });
    return { items, page };
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
