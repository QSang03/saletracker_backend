import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import {
  CustomerAppointment,
  CustomerAppointmentSyncState,
} from './customer-appointment.entity';
import { Customer } from './customer.entity';
import { User } from '../users/user.entity';
import { NkmSaleMap } from './nkm-sale-map.entity';
import { SystemConfig } from '../system_config/system_config.entity';
import {
  appointmentRange,
  normAppointmentCode,
  providerTime,
  resolveAppointmentCustomer,
  resolveAppointmentSale,
  validateAppointmentReport,
} from './appointment-policy';
import { shiftDateStr, vnToday } from './vn-date';

@Injectable()
export class CustomerAppointmentsService implements OnModuleInit {
  private readonly logger = new Logger(CustomerAppointmentsService.name);
  constructor(private readonly db: DataSource) {}

  async onModuleInit() {
    // Retire the legacy setting; historical messages remain read-only evidence.
    await this.db
      .getRepository(SystemConfig)
      .delete({ name: 'movement_report_pattern', section: 'kpi' });
  }

  @Cron('0 */5 * * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async scheduledSync() {
    if (process.env.CUSTOMER_APPOINTMENTS_ENABLED !== 'true') return;
    try {
      await this.sync();
    } catch {
      this.logger.error(
        'Đồng bộ lịch hẹn thất bại; xem customer_appointment_sync_state',
      );
    }
  }

  private async fetchReport(): Promise<any> {
    const key = process.env.CUSTOMER_APPOINTMENTS_API_KEY;
    const endpoint =
      process.env.CUSTOMER_APPOINTMENTS_URL ||
      'http://192.168.245.188:3031/api/report/sales';
    const url = new URL(endpoint);
    if (
      !key ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.search ||
      url.username ||
      url.password
    ) {
      throw new ServiceUnavailableException(
        'Thiếu hoặc sai cấu hình API lịch hẹn',
      );
    }
    // No date filters: include future appointments and corrections to old records.
    // Counts are validated below, so a truncated response cannot replace local data.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, {
          headers: { 'X-Api-Key': key },
          signal: AbortSignal.timeout(20000),
          redirect: 'error',
        });
        if (!response.ok) {
          if (response.status < 500 && response.status !== 429)
            throw new BadRequestException('API lịch hẹn từ chối yêu cầu');
          throw new Error('Provider temporarily unavailable');
        }
        return await response.json();
      } catch (error) {
        if (error instanceof BadRequestException || attempt === 2)
          throw new ServiceUnavailableException(
            'Không lấy được dữ liệu API lịch hẹn',
          );
        await new Promise((resolve) =>
          setTimeout(resolve, (attempt + 1) * 500),
        );
      }
    }
  }

  async sync() {
    const runner = this.db.createQueryRunner();
    await runner.connect();
    let locked = false;
    let transaction = false;
    try {
      const [lock] = await runner.query(
        "SELECT GET_LOCK(CONCAT(DATABASE(), ':customer-appointments'), 0) AS acquired",
      );
      locked = Number(lock.acquired) === 1;
      if (!locked)
        throw new ConflictException('Đang có tiến trình đồng bộ lịch hẹn');
      const states = runner.manager.getRepository(CustomerAppointmentSyncState);
      const previous = await states.findOneBy({ id: 1 });
      await states.save({
        id: 1,
        status: 'running',
        last_attempt_at: new Date().toISOString(),
        error: null,
      });
      const rows = validateAppointmentReport(await this.fetchReport());
      await runner.startTransaction();
      transaction = true;
      const maps = await runner.manager.find(NkmSaleMap);
      const users = await runner.manager.find(User);
      const customers = await runner.manager.find(Customer);
      const repo = runner.manager.getRepository(CustomerAppointment);
      const existing = new Map(
        (await repo.find()).map((a) => [a.source_id, a]),
      );
      const now = new Date().toISOString();
      let ignored = 0;
      const pending: CustomerAppointment[] = [];
      for (const { sale, appointment: a } of rows) {
        if (!normAppointmentCode(sale.sale_code)) {
          ignored++;
          continue;
        }
        const mappedSale = resolveAppointmentSale(sale.sale_code, maps, users);
        const mappedCustomer = resolveAppointmentCustomer(
          a.customer.code,
          a.customer.erp_cc,
          customers,
        );
        const old = existing.get(a.appointment_id);
        let mapping =
          mappedSale.status !== 'matched'
            ? mappedSale.status
            : mappedCustomer.status;
        // Do not silently transfer historical evidence when the lookup file changes.
        if (
          old?.user_id &&
          mappedSale.userId &&
          old.user_id !== mappedSale.userId &&
          old.source_sale_id === sale.sale_id &&
          old.source_sale_code === String(sale.sale_code)
        )
          mapping = 'mapping_conflict';
        if (old && old.source_updated_at > a.updated_at)
          throw new Error('Provider returned an older appointment version');
        pending.push(
          repo.create({
            id: old?.id,
            source_id: a.appointment_id,
            source_sale_id: sale.sale_id,
            source_sale_code: String(sale.sale_code),
            sale_name: String(sale.sale_name || ''),
            user_id:
              mapping === 'mapping_conflict' ? old!.user_id : mappedSale.userId,
            customer_id: mappedCustomer.customerId,
            customer_code: normAppointmentCode(a.customer.code),
            sap_code: normAppointmentCode(a.customer.erp_cc),
            customer_name: a.customer.name || null,
            appointment_code: String(a.appointment_code || ''),
            title: String(a.title || ''),
            status: a.status,
            purpose: String(a.purpose || 'other'),
            scheduled_at: providerTime(a.scheduled_at, true)!,
            scheduled_end: providerTime(a.scheduled_end),
            checkin_at: providerTime(a.checkin?.time),
            checkout_at: providerTime(a.checkout?.time),
            source_updated_at: providerTime(a.updated_at, true)!,
            mapping_status: mapping,
            payload: a,
            synced_at: now,
          }),
        );
      }
      if (pending.length) await repo.save(pending, { chunk: 200 });
      // Absence alone is not proof of deletion. Retain evidence, suspend scoring
      // until it reappears rather than presenting old completion as current truth.
      const seen = new Set(pending.map((a) => a.source_id));
      const missing = [...existing.values()].filter(
        (a) => !seen.has(a.source_id),
      );
      if (missing.length)
        await repo.save(
          missing.map((a) => ({ ...a, mapping_status: 'source_missing' })),
          { chunk: 200 },
        );
      await states.save({
        id: 1,
        last_success_at: now,
        status: 'success',
        error: null,
        total: pending.length,
        ignored,
      });
      await runner.commitTransaction();
      transaction = false;
      return {
        total: pending.length,
        ignored,
        lastSuccessAt: now,
        previousSuccessAt: previous?.last_success_at ?? null,
      };
    } catch (error) {
      if (transaction) {
        await runner.rollbackTransaction();
        transaction = false;
      }
      if (locked)
        await runner.manager.getRepository(CustomerAppointmentSyncState).save({
          id: 1,
          status: 'error',
          error: 'Đồng bộ thất bại; dữ liệu cũ được giữ nguyên',
        });
      if (error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException(
        'Đồng bộ lịch hẹn thất bại; dữ liệu cũ được giữ nguyên',
      );
    } finally {
      try {
        if (locked)
          await runner.query(
            "SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':customer-appointments'))",
          );
      } finally {
        await runner.release();
      }
    }
  }

  async syncStatus() {
    const state = await this.db
      .getRepository(CustomerAppointmentSyncState)
      .findOneBy({ id: 1 });
    const stale =
      !state?.last_success_at ||
      !Number.isFinite(Date.parse(state.last_success_at)) ||
      Date.parse(state.last_success_at) > Date.now() + 60000 ||
      Date.now() - Date.parse(state.last_success_at) > 15 * 60000;
    return {
      timezone: 'Asia/Ho_Chi_Minh',
      lastSuccessAt: state?.last_success_at ?? null,
      lastAttemptAt: state?.last_attempt_at ?? null,
      status: state?.status ?? 'never',
      stale,
      error: state?.error ?? null,
    };
  }

  /** Same scope as CustomerKpiReportsService, including departments with server_ip. */
  private async scope(user: any): Promise<number[] | undefined> {
    if (!user?.id) throw new ForbiddenException();
    const roles = (user.roles || []).map((r: any) =>
      String(typeof r === 'string' ? r : r.name).toLowerCase(),
    );
    if (roles.some((r) => ['admin', 'view', 'pm-khach-hang'].includes(r)))
      return undefined;
    if (!roles.some((r) => r.startsWith('manager-'))) return [Number(user.id)];
    const ids = (user.departments || [])
      .filter((d: any) => String(d.server_ip || '').trim())
      .map((d: any) => d.id);
    if (!ids.length) return [];
    const users = await this.db
      .getRepository(User)
      .createQueryBuilder('u')
      .innerJoin('u.departments', 'd')
      .where('d.id IN (:...ids)', { ids })
      .andWhere('u.deletedAt IS NULL')
      .getMany();
    return users.map((u) => u.id);
  }

  private async scopedQuery(user: any, saleId?: number) {
    const ids = await this.scope(user);
    if (saleId && ids && !ids.includes(saleId))
      throw new ForbiddenException('Bạn không có quyền xem sale này');
    const qb = this.db
      .getRepository(CustomerAppointment)
      .createQueryBuilder('a');
    if (saleId) qb.where('a.user_id = :saleId', { saleId });
    else if (ids?.length) qb.where('a.user_id IN (:...ids)', { ids });
    else if (ids) qb.where('1 = 0');
    else qb.where('a.user_id IS NOT NULL');
    return qb;
  }

  private dto(a: CustomerAppointment) {
    const p = a.payload;
    // Never expose raw provider payload or LAN image URLs. Photos use authenticated proxy.
    const photo = (kind: string) =>
      p[kind]?.photo ? `/customer-appointments/${a.id}/photos/${kind}` : null;
    return {
      id: a.id,
      sourceId: a.source_id,
      appointmentCode: a.appointment_code,
      title: a.title,
      saleId: a.user_id,
      saleName: a.sale_name,
      customerId: a.customer_id,
      customerCode: a.customer_code,
      sapCode: a.sap_code,
      customerName: a.customer_name,
      status: a.status,
      statusLabel: p.status_label,
      purpose: a.purpose,
      purposeLabel: p.purpose_label,
      scheduledAt: a.scheduled_at,
      scheduledEnd: a.scheduled_end,
      checkinAt: a.checkin_at,
      checkoutAt: a.checkout_at,
      meetingMinutes: p.meeting_minutes ?? null,
      location: p.location ?? null,
      contactName: p.contact_name ?? null,
      contactPhone: p.contact_phone ?? null,
      note: p.note ?? null,
      result: p.result ?? null,
      alerts: p.alerts ?? [],
      companions: (p.companions ?? []).map((c: any) => ({
        name: c.full_name,
        saleCode: c.sale_code,
      })),
      checkin: p.checkin ? { ...p.checkin, photo: photo('checkin') } : null,
      checkout: p.checkout ? { ...p.checkout, photo: photo('checkout') } : null,
      mappingStatus: a.mapping_status,
      syncedAt: a.synced_at,
      sourceUpdatedAt: a.source_updated_at,
      qualifiesAsVisit:
        a.mapping_status === 'matched' &&
        a.status === 'completed' &&
        !!a.checkin_at,
    };
  }

  async list(
    query: {
      from: string;
      to: string;
      dateBy?: string;
      saleId?: number;
      customerId?: number;
      status?: string;
      page?: number;
      pageSize?: number;
    },
    user: any,
  ) {
    appointmentRange(query.from, query.to);
    const qb = await this.scopedQuery(user, query.saleId);
    const column =
      query.dateBy === 'checkin' ? 'a.checkin_at' : 'a.scheduled_at';
    qb.andWhere(`${column} >= :from AND ${column} < :until`, {
      from: `${query.from} 00:00:00`,
      until: `${shiftDateStr(query.to, 1)} 00:00:00`,
    });
    if (query.customerId)
      qb.andWhere('a.customer_id = :customerId', {
        customerId: query.customerId,
      });
    if (query.status)
      qb.andWhere('a.status = :status', { status: query.status });
    const page = query.page ?? 1,
      pageSize = query.pageSize ?? 20;
    const [rows, total] = await qb
      .orderBy(column, 'ASC')
      .addOrderBy('a.id', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return {
      data: rows.map((a) => this.dto(a)),
      total,
      page,
      pageSize,
      sync: await this.syncStatus(),
    };
  }

  private async find(id: number, user: any) {
    const a = await (
      await this.scopedQuery(user)
    )
      .andWhere('a.id = :id', { id })
      .getOne();
    if (!a) throw new NotFoundException('Không tìm thấy lịch hẹn');
    return a;
  }

  async detail(id: number, user: any) {
    return {
      data: this.dto(await this.find(id, user)),
      sync: await this.syncStatus(),
    };
  }

  async photo(id: number, kind: string, user: any) {
    const a = await this.find(id, user);
    const value = a.payload[kind]?.photo;
    if (!['checkin', 'checkout'].includes(kind) || !value)
      throw new NotFoundException();
    const base = new URL(
      process.env.CUSTOMER_APPOINTMENTS_URL ||
        'http://192.168.245.188:3031/api/report/sales',
    );
    const url = new URL(value, base);
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith('/uploads/') ||
      url.username ||
      url.password
    )
      throw new BadRequestException('Đường dẫn ảnh không hợp lệ');
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    const type = response.headers.get('content-type')?.split(';')[0] || '';
    if (
      !response.ok ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(type)
    )
      throw new ServiceUnavailableException('Không tải được ảnh');
    const reader = response.body?.getReader();
    if (!reader) throw new ServiceUnavailableException();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value: bytes } = await reader.read();
        if (done) break;
        size += bytes.length;
        if (size > 10 * 1024 * 1024)
          throw new BadRequestException('Ảnh vượt giới hạn 10 MB');
        chunks.push(Buffer.from(bytes));
      }
    } finally {
      await reader.cancel();
    }
    return { bytes: Buffer.concat(chunks), type };
  }

  /** Reasons prevent lack of mapping/sync from being reported as a failed visit. */
  async unavailableReasons(
    assignments: {
      assignmentId: number;
      saleId: number;
      customerId: number;
      customerCode: string;
    }[],
    from: string,
    to: string,
  ) {
    const reasons = new Map<number, string>();
    const status = await this.syncStatus();
    const [maps, users, unresolved] = await Promise.all([
      this.db.getRepository(NkmSaleMap).find(),
      this.db.getRepository(User).find(),
      this.db
        .getRepository(CustomerAppointment)
        .createQueryBuilder('a')
        .where('a.mapping_status <> :matched', { matched: 'matched' })
        .getMany(),
    ]);
    for (const a of assignments) {
      let reason: string | undefined;
      if (status.stale)
        reason =
          'Dữ liệu lịch hẹn chưa đồng bộ hoặc đã quá 15 phút; chưa thể kết luận KPI.';
      const user = users.find((u) => u.id === a.saleId);
      const saleMaps = maps.filter(
        (m) =>
          m.is_active &&
          normAppointmentCode(m.employee_code) ===
            normAppointmentCode(user?.employeeCode) &&
          !!normAppointmentCode(user?.employeeCode),
      );
      if (
        !saleMaps.length ||
        saleMaps.some(
          (m) =>
            resolveAppointmentSale(m.slp_code, maps, users).userId !== a.saleId,
        )
      )
        reason = 'Chưa xác định duy nhất mã sale lịch hẹn cho nhân viên.';
      if (
        unresolved.some(
          (e) =>
            (e.user_id === a.saleId ||
              saleMaps.some(
                (m) => String(m.slp_code) === e.source_sale_code,
              )) &&
            e.status === 'completed' &&
            !!e.checkin_at &&
            (!normAppointmentCode(e.customer_code) ||
              normAppointmentCode(e.customer_code) ===
                normAppointmentCode(a.customerCode)) &&
            (e.checkin_at || e.scheduled_at).slice(0, 10) >= from &&
            (e.checkin_at || e.scheduled_at).slice(0, 10) <= to,
        )
      )
        reason = 'Có lịch hẹn chưa đối chiếu được sale/khách hàng.';
      if (reason) reasons.set(a.assignmentId, reason);
    }
    return reasons;
  }
}
