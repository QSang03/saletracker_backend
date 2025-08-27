import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtendReason, OrderDetail } from './order-detail.entity';
import { Department } from 'src/departments/department.entity';
import { User } from 'src/users/user.entity';
import { OrderBlacklistService } from '../order-blacklist/order-blacklist.service';

interface HiddenOrderOptions {
  page?: number;
  pageSize?: number;
  employees?: string;
  departments?: string;
  status?: string;
  search?: string;
  hiddenDateRange?: { start: string; end: string };
  sortField?: 'quantity' | 'unit_price' | 'hidden_at' | null;
  sortDirection?: 'asc' | 'desc' | null;
}

@Injectable()
export class OrderDetailService {
  constructor(
    @InjectRepository(OrderDetail)
    private orderDetailRepository: Repository<OrderDetail>,
    @InjectRepository(Department)
    private departmentRepository: Repository<Department>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private orderBlacklistService: OrderBlacklistService,
  ) {}

  async findAll(): Promise<OrderDetail[]> {
    return this.orderDetailRepository.find({
      relations: ['order', 'order.sale_by', 'product'],
    });
  }

  // Helper method để lấy user IDs dựa trên role của user
  private async getUserIdsByRole(user: any): Promise<number[] | null> {
    if (!user) return null;

    const roleNames = (user.roles || []).map((r: any) =>
      typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
    );

    const isAdmin = roleNames.includes('admin');
    if (isAdmin) return null; // Admin có thể xem tất cả

    // Kiểm tra role "view" - chỉ cho phép xem phòng ban được phân quyền
    const isViewRole = roleNames.includes('view');
    if (isViewRole) {
      // Role view cần check phòng ban được phân quyền
      // Lấy departments từ user.departments hoặc từ permissions
      let departmentIds: number[] = [];
      
      // Thử lấy từ user.departments trước
      if (user.departments && user.departments.length > 0) {
        departmentIds = user.departments.map((dept: any) => dept.id);
      }
      
      // Nếu không có departments, thử lấy từ permissions
      if (departmentIds.length === 0 && user.permissions) {
        const permissionNames = user.permissions.map((p: any) => p.name);
        const departmentSlugs = permissionNames.filter((name: string) => 
          !name.includes('thong-ke') && !name.includes('thong_ke')
        );
        
        if (departmentSlugs.length > 0) {
          const departments = await this.departmentRepository
            .createQueryBuilder('dept')
            .where('dept.slug IN (:...slugs)', { slugs: departmentSlugs })
            .andWhere('dept.server_ip IS NOT NULL')
            .andWhere("TRIM(dept.server_ip) <> ''")
            .getMany();
          
          departmentIds = departments.map((d) => d.id);
        }
      }
      
      if (departmentIds.length === 0) {
        return []; // Không có phòng ban nào được phân quyền
      }
      
      // Lấy tất cả user trong các phòng ban được phân quyền
      const usersInDepartments = await this.userRepository
        .createQueryBuilder('user')
        .leftJoin('user.departments', 'dept')
        .where('dept.id IN (:...departmentIds)', { departmentIds })
        .andWhere('user.deletedAt IS NULL')
        .getMany();

      return usersInDepartments.map((u) => u.id);
    }

    // Kiểm tra role PM
    const isPM = roleNames.includes('pm');
    if (isPM) {
      // Kiểm tra có role pm_{phong_ban} nào không
      const pmRoles = roleNames.filter((r: string) => r.startsWith('pm-'));
      if (pmRoles.length === 0) {
        return []; // Chỉ có PM mà không có pm_{phong_ban} → trả về mảng rỗng
      }
      
      // Có role pm_{phong_ban} → lọc theo phòng ban đó
      const departmentSlugs = pmRoles.map((r: string) => r.replace('pm-', ''));
      
      const departments = await this.departmentRepository
        .createQueryBuilder('dept')
        .where('dept.slug IN (:...slugs)', { slugs: departmentSlugs })
        .andWhere('dept.server_ip IS NOT NULL')
        .andWhere("TRIM(dept.server_ip) <> ''")
        .getMany();

      if (departments.length > 0) {
        const departmentIds = departments.map((d) => d.id);

        const usersInDepartments = await this.userRepository
          .createQueryBuilder('user')
          .leftJoin('user.departments', 'dept')
          .where('dept.id IN (:...departmentIds)', { departmentIds })
          .getMany();

        return usersInDepartments.map((u) => u.id);
      }
      return []; // PM không có department hợp lệ
    }

    const managerRoles = roleNames.filter((r: string) =>
      r.startsWith('manager-'),
    );

    if (managerRoles.length > 0) {
      // Manager: lấy tất cả user trong phòng ban có server_ip hợp lệ
      const departmentSlugs = managerRoles.map((r: string) =>
        r.replace('manager-', ''),
      );

      const departments = await this.departmentRepository
        .createQueryBuilder('dept')
        .where('dept.slug IN (:...slugs)', { slugs: departmentSlugs })
        .andWhere('dept.server_ip IS NOT NULL')
        .andWhere("TRIM(dept.server_ip) <> ''")
        .getMany();

      if (departments.length > 0) {
        const departmentIds = departments.map((d) => d.id);

        const usersInDepartments = await this.userRepository
          .createQueryBuilder('user')
          .leftJoin('user.departments', 'dept')
          .where('dept.id IN (:...departmentIds)', { departmentIds })
          .getMany();

        return usersInDepartments.map((u) => u.id);
      } else {
        return []; // Manager không có department hợp lệ
      }
    } else {
      // User thường: chỉ xem của chính họ
      return [user.id];
    }
  }

  // Helper method để parse customer_id từ metadata JSON
  private extractCustomerIdFromMetadata(metadata: any): string | null {
    try {
      if (typeof metadata === 'string') {
        const parsed = JSON.parse(metadata);
        return parsed.customer_id || null;
      } else if (typeof metadata === 'object' && metadata !== null) {
        return metadata.customer_id || null;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  async findAllWithPermission(user?: any): Promise<OrderDetail[]> {
    const queryBuilder = this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoinAndSelect('details.order', 'order')
      .leftJoinAndSelect('details.product', 'product')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .andWhere('details.hidden_at IS NULL');

    const allowedUserIds = await this.getUserIdsByRole(user);

    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) {
        queryBuilder.andWhere('1 = 0'); // Không có quyền xem gì
      } else {
        queryBuilder.andWhere('sale_by.id IN (:...userIds)', {
          userIds: allowedUserIds,
        });
      }
    }
    // Admin (allowedUserIds === null) không có điều kiện gì

    const orderDetails = await queryBuilder.getMany();

    // ✅ Apply blacklist filtering at application level
    if (user && user.roles && user.roles.length > 0) {
      const roleNames = (user.roles || []).map((r: any) =>
        typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
      );

      const isAdmin = roleNames.includes('admin');
      const isManager = roleNames.some((r: string) => r.startsWith('manager-'));

      if (!isAdmin) {
        // Admin không filter blacklist
        let blacklistedSet = new Set<string>();
        if (isManager) {
          const userIds = Array.isArray(allowedUserIds)
            ? allowedUserIds
            : [user.id];
          const map =
            await this.orderBlacklistService.getBlacklistedContactsForUsers(
              userIds,
            );
          for (const set of map.values()) {
            for (const id of set) blacklistedSet.add(id);
          }
        } else {
          const list =
            await this.orderBlacklistService.getBlacklistedContactsForUser(
              user.id,
            );
          for (const id of list) blacklistedSet.add(id);
        }

        if (blacklistedSet.size > 0) {
          return orderDetails.filter((orderDetail) => {
            const customerId = this.extractCustomerIdFromMetadata(
              orderDetail.metadata,
            );
            return !customerId || !blacklistedSet.has(customerId);
          });
        }
      }
    }

    return orderDetails;
  }

  async findById(id: number): Promise<OrderDetail | null> {
    return this.orderDetailRepository.findOne({
      where: { id },
      relations: ['order', 'order.sale_by', 'product'],
    });
  }

  async findByIdWithPermission(
    id: number,
    user?: any,
  ): Promise<OrderDetail | null> {
    const orderDetail = await this.findById(id);

    // Kiểm tra quyền xem order detail này
    if (orderDetail && user) {
      const allowedUserIds = await this.getUserIdsByRole(user);

      if (allowedUserIds !== null) {
        if (
          allowedUserIds.length === 0 ||
          !allowedUserIds.includes(orderDetail.order.sale_by?.id)
        ) {
          return null; // Không có quyền xem
        }

        // Kiểm tra blacklist cho user thường và manager
        const roleNames = (user.roles || []).map((r: any) =>
          typeof r === 'string'
            ? r.toLowerCase()
            : (r.name || '').toLowerCase(),
        );

        const isAdmin = roleNames.includes('admin');
        const isManager = roleNames.some((r: string) =>
          r.startsWith('manager-'),
        );

        if (!isAdmin) {
          const customerId = this.extractCustomerIdFromMetadata(
            orderDetail.metadata,
          );
          if (customerId) {
            if (isManager) {
              const userIds = Array.isArray(allowedUserIds)
                ? allowedUserIds
                : [user.id];
              const map =
                await this.orderBlacklistService.getBlacklistedContactsForUsers(
                  userIds,
                );
              for (const set of map.values()) {
                if (set.has(customerId)) return null; // Bị blacklist bởi user trong scope của manager
              }
            } else {
              const isBlacklisted =
                await this.orderBlacklistService.isBlacklisted(
                  user.id,
                  customerId,
                );
              if (isBlacklisted) {
                return null; // Bị blacklist, không được xem
              }
            }
          }
        }
      }
      // Admin (allowedUserIds === null) có thể xem tất cả
    }

    return orderDetail;
  }

  async findByOrderId(orderId: number): Promise<OrderDetail[]> {
    return this.orderDetailRepository.find({
      where: { order_id: orderId },
      relations: ['product'],
    });
  }

  async findByZaloMessageId(
    zaloMessageId: string,
  ): Promise<OrderDetail | null> {
    return this.orderDetailRepository.findOne({ where: { zaloMessageId } });
  }

  async getCustomerNameByZaloMessageId(
    zaloMessageId: string,
  ): Promise<string | null> {
    const detail = await this.orderDetailRepository.findOne({
      where: { zaloMessageId },
    });
    return detail?.customer_name || null;
  }

  async create(orderDetailData: Partial<OrderDetail>): Promise<OrderDetail> {
    const orderDetail = this.orderDetailRepository.create(orderDetailData);
    return this.orderDetailRepository.save(orderDetail);
  }

  async update(
    id: number,
    orderDetailData: Partial<OrderDetail>,
    user?: any,
  ): Promise<OrderDetail | null> {
    // Determine if we need the current row
    const needsExisting =
      orderDetailData.extended !== undefined ||
      typeof orderDetailData.notes === 'string';
    const currentOrderDetail = needsExisting ? await this.findById(id) : null;

    // ✅ Xử lý đặc biệt cho trường extended - cộng thêm thay vì ghi đè
    if (orderDetailData.extended !== undefined && currentOrderDetail) {
      const currentExtended = currentOrderDetail.extended || 4;
      orderDetailData.extended = currentExtended + orderDetailData.extended;

      if ((orderDetailData.extended || 0) > currentExtended) {
        orderDetailData.last_extended_at = new Date();
        orderDetailData.extend_reason = ExtendReason.USER_MANUAL;
      }
    }

    // ✅ Ghi lại lịch sử thay đổi ghi chú nếu có cập nhật notes
    if (typeof orderDetailData.notes === 'string') {
      // Parse existing history
      let history: any[] = [];
      const raw = (currentOrderDetail as any)?.notes_history;
      try {
        if (Array.isArray(raw)) history = raw;
        else if (raw && typeof raw === 'string') history = JSON.parse(raw);
      } catch {
        history = [];
      }

      history.push({
        user_id: user?.id ?? null,
        content: orderDetailData.notes,
        changed_at: new Date().toISOString(),
      });

      // Optional cap to avoid unbounded growth
      if (history.length > 500) history = history.slice(-500);

      await this.orderDetailRepository.update(id, {
        ...orderDetailData,
        notes_history: history,
      });
    } else {
      await this.orderDetailRepository.update(id, orderDetailData);
    }

    return this.findById(id);
  }

  async updateCustomerName(
    id: number,
    customerName: string,
    user?: any,
  ): Promise<OrderDetail | null> {
    // Lấy thông tin order detail hiện tại để extract customer_id từ metadata
    const currentOrderDetail = await this.findById(id);
    if (!currentOrderDetail) {
      throw new Error('Order detail not found');
    }

    // Parse metadata để lấy customer_id
    let customerId: string | null = null;
    try {
      if (currentOrderDetail.metadata) {
        const metadata =
          typeof currentOrderDetail.metadata === 'string'
            ? JSON.parse(currentOrderDetail.metadata)
            : currentOrderDetail.metadata;
        customerId = metadata.customer_id;
      }
    } catch (error) {
      // ignore
    }

    if (customerId) {
      // Tìm tất cả order details có cùng customer_id trong metadata nhưng CHỈ của user hiện tại
      const orderDetailsWithSameCustomer = await this.orderDetailRepository
        .createQueryBuilder('orderDetail')
        .leftJoin('orderDetail.order', 'order')
        .leftJoin('order.sale_by', 'sale_by')
        .where(
          "JSON_UNQUOTE(JSON_EXTRACT(orderDetail.metadata, '$.customer_id')) = :customerId",
          {
            customerId,
          },
        )
        .andWhere('sale_by.id = :userId', { userId: user?.id })
        .getMany();

      // Cập nhật tên khách hàng cho tất cả order details có cùng customer_id thuộc sở hữu user
      const idsToUpdate = orderDetailsWithSameCustomer.map((od) => od.id);
      if (idsToUpdate.length > 0) {
        await this.orderDetailRepository
          .createQueryBuilder()
          .update(OrderDetail)
          .set({ customer_name: customerName })
          .where('id IN (:...ids)', { ids: idsToUpdate })
          .execute();
      }
    } else {
      // Fallback: chỉ cập nhật order detail hiện tại nếu là của user hiện tại
      if (currentOrderDetail.order?.sale_by?.id === user?.id) {
        await this.orderDetailRepository.update(id, {
          customer_name: customerName,
        });
      }
    }

    return this.findById(id);
  }

  async updateCustomerNameByCustomerId(
    customerId: string,
    customerName: string,
  ): Promise<{ updated: number }> {
    const orderDetails = await this.orderDetailRepository
      .createQueryBuilder('orderDetail')
      .where(
        "JSON_UNQUOTE(JSON_EXTRACT(orderDetail.metadata, '$.customer_id')) = :customerId",
        { customerId },
      )
      .getMany();

    const idsToUpdate = orderDetails.map((od) => od.id);

    if (idsToUpdate.length > 0) {
      await this.orderDetailRepository
        .createQueryBuilder()
        .update()
        .set({ customer_name: customerName })
        .where('id IN (:...ids)', { ids: idsToUpdate })
        .execute();
    }

    return { updated: idsToUpdate.length };
  }

  async delete(id: number, reason?: string): Promise<void> {
    // Deletion no longer requires a reason; keep reason unchanged
    await this.orderDetailRepository.softDelete(id);
  }

  async deleteByOrderId(orderId: number): Promise<void> {
    await this.orderDetailRepository.softDelete({ order_id: orderId });
  }

  // ✅ Bulk operations
  async bulkDelete(
    ids: number[],
    reason: string,
    user: any,
  ): Promise<{ deleted: number }> {
    // Chỉ cho phép xóa các order detail thuộc sở hữu của user hiện tại
    const orderDetails = await this.orderDetailRepository
      .createQueryBuilder('orderDetail')
      .leftJoinAndSelect('orderDetail.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .where('orderDetail.id IN (:...ids)', { ids })
      .andWhere('sale_by.id = :userId', { userId: user.id })
      .getMany();

    if (orderDetails.length === 0) {
      return { deleted: 0 };
    }

    // Soft delete without reason requirement
    await this.orderDetailRepository.softDelete(
      orderDetails.map((od) => od.id),
    );

    return { deleted: orderDetails.length };
  }

  async bulkUpdate(
    ids: number[],
    updates: Partial<OrderDetail>,
    user: any,
  ): Promise<{ updated: number }> {
    // Chỉ cho phép cập nhật các order detail thuộc sở hữu của user hiện tại
    const orderDetails = await this.orderDetailRepository
      .createQueryBuilder('orderDetail')
      .leftJoinAndSelect('orderDetail.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .where('orderDetail.id IN (:...ids)', { ids })
      .andWhere('sale_by.id = :userId', { userId: user.id })
      .getMany();

    if (orderDetails.length === 0) {
      return { updated: 0 };
    }

    // Nếu có cập nhật notes, cần ghi lịch sử theo từng item
    if (typeof updates.notes === 'string') {
      for (const od of orderDetails) {
        let history: any[] = [];
        const raw = (od as any).notes_history;
        try {
          if (Array.isArray(raw)) history = raw;
          else if (raw && typeof raw === 'string') history = JSON.parse(raw);
        } catch {
          history = [];
        }
        history.push({
          user_id: user?.id ?? null,
          content: updates.notes,
          changed_at: new Date().toISOString(),
        });
        if (history.length > 500) history = history.slice(-500);

        await this.orderDetailRepository.update(od.id, {
          ...updates,
          notes_history: history,
        });
      }
      return { updated: orderDetails.length };
    }

    // Không có cập nhật notes: có thể update hàng loạt
    await this.orderDetailRepository.update(orderDetails.map((od) => od.id), updates);
    return { updated: orderDetails.length };
  }

  async bulkExtend(ids: number[], user: any): Promise<{ updated: number }> {
    // Chỉ cho phép gia hạn các order detail thuộc sở hữu của user hiện tại
    const orderDetails = await this.orderDetailRepository
      .createQueryBuilder('orderDetail')
      .leftJoinAndSelect('orderDetail.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .where('orderDetail.id IN (:...ids)', { ids })
      .andWhere('sale_by.id = :userId', { userId: user.id })
      .getMany();

    if (orderDetails.length === 0) {
      return { updated: 0 };
    }

    // Gia hạn thêm 4 ngày cho mỗi order detail
    for (const orderDetail of orderDetails) {
      const currentExtended = orderDetail.extended || 4;
      await this.orderDetailRepository.update(orderDetail.id, {
        extended: currentExtended + 4,
        last_extended_at: new Date(),
        extend_reason: ExtendReason.USER_MANUAL,
      });
    }

    return { updated: orderDetails.length };
  }

  async bulkAddNotes(
    ids: number[],
    notes: string,
    user: any,
  ): Promise<{ updated: number }> {
    // Chỉ cho phép ghi chú các order detail thuộc sở hữu của user hiện tại
    const orderDetails = await this.orderDetailRepository
      .createQueryBuilder('orderDetail')
      .leftJoinAndSelect('orderDetail.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .where('orderDetail.id IN (:...ids)', { ids })
      .andWhere('sale_by.id = :userId', { userId: user.id })
      .getMany();

    if (orderDetails.length === 0) {
      return { updated: 0 };
    }

    // ✅ Ghi đè ghi chú và lưu lịch sử cho từng item
    for (const od of orderDetails) {
      let history: any[] = [];
      const raw = (od as any).notes_history;
      try {
        if (Array.isArray(raw)) history = raw;
        else if (raw && typeof raw === 'string') history = JSON.parse(raw);
      } catch {
        history = [];
      }
      history.push({
        user_id: user?.id ?? null,
        content: notes,
        changed_at: new Date().toISOString(),
      });
      if (history.length > 500) history = history.slice(-500);

      await this.orderDetailRepository.update(od.id, {
        notes,
        notes_history: history,
      });
    }

    return { updated: orderDetails.length };
  }

  // =============== Stats: detailed rows ===============
  private startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  private endOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  private startOfWeekMonday(d: Date): Date {
    const date = this.startOfDay(d);
    const day = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - day);
    return date;
  }

  private endOfWeekSunday(d: Date): Date {
    const s = this.startOfWeekMonday(d);
    const e = new Date(s);
    e.setDate(s.getDate() + 6);
    return this.endOfDay(e);
  }

  private startOfMonth(d: Date): Date {
    return this.startOfDay(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  private endOfMonth(d: Date): Date {
    return this.endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }

  private startOfQuarter(d: Date): Date {
    const q = Math.floor(d.getMonth() / 3);
    return this.startOfDay(new Date(d.getFullYear(), q * 3, 1));
  }

  private endOfQuarter(d: Date): Date {
    const s = this.startOfQuarter(d);
    return this.endOfDay(new Date(s.getFullYear(), s.getMonth() + 3, 0));
  }

  private getDateRange(
    period: string,
    date?: string,
    dateFrom?: string,
    dateTo?: string,
  ): {
    from: Date;
    to: Date;
    normalizedPeriod: 'day' | 'week' | 'month' | 'quarter' | 'custom';
  } {
    const p = (period || 'day').toLowerCase();
    const today = new Date();
    if (p === 'custom' && dateFrom && dateTo)
      return {
        from: this.startOfDay(new Date(dateFrom)),
        to: this.endOfDay(new Date(dateTo)),
        normalizedPeriod: 'custom',
      };
    const target = date ? new Date(date) : today;
    if (p === 'week')
      return {
        from: this.startOfWeekMonday(target),
        to: this.endOfWeekSunday(target),
        normalizedPeriod: 'week',
      };
    if (p === 'month')
      return {
        from: this.startOfMonth(target),
        to: this.endOfMonth(target),
        normalizedPeriod: 'month',
      };
    if (p === 'quarter')
      return {
        from: this.startOfQuarter(target),
        to: this.endOfQuarter(target),
        normalizedPeriod: 'quarter',
      };
    return {
      from: this.startOfDay(target),
      to: this.endOfDay(target),
      normalizedPeriod: 'day',
    };
  }

  private parseCsvNumbers(csv?: string): number[] {
    if (!csv) return [];
    return csv
      .split(',')
      .map((s) => Number((s || '').trim()))
      .filter((n) => !Number.isNaN(n));
  }

  private parseCsvStrings(csv?: string): string[] {
    if (!csv) return [];
    return csv
      .split(',')
      .map((s) => (s || '').trim())
      .filter((s) => s.length > 0);
  }

  private calcDynamicExtended(
    createdAt: Date | null,
    originalExtended: number | null,
  ): number | null {
    try {
      if (!createdAt || originalExtended === null) {
        return typeof originalExtended === 'number' ? originalExtended : null;
      }
      const createdDate = new Date(createdAt);
      createdDate.setHours(0, 0, 0, 0);
      const expiredDate = new Date(createdDate);
      expiredDate.setDate(expiredDate.getDate() + (originalExtended || 0));
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diffDays = Math.floor(
        (expiredDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      return diffDays;
    } catch {
      return typeof originalExtended === 'number' ? originalExtended : null;
    }
  }

  async getDetailedStats(params: {
    period: string;
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    status?: string;
    employees?: string;
    departments?: string;
    products?: string;
    user: any;
  }): Promise<any> {
    const { from, to, normalizedPeriod } = this.getDateRange(
      params.period,
      params.date,
      params.dateFrom,
      params.dateTo,
    );
    const qb = this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoinAndSelect('details.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .leftJoinAndSelect('details.product', 'product')
      .leftJoinAndSelect('sale_by.departments', 'sale_by_departments')
      .where('order.created_at BETWEEN :from AND :to', { from, to })
      .andWhere('details.deleted_at IS NULL');

    // Permission scoping
    const allowedUserIds = await this.getUserIdsByRole(params.user);
    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) qb.andWhere('1 = 0');
      else
        qb.andWhere('sale_by.id IN (:...userIds)', { userIds: allowedUserIds });
    }

    // Filters
    const statuses = this.parseCsvStrings(params.status);
    if (statuses.length > 0)
      qb.andWhere('details.status IN (:...sts)', { sts: statuses });

    const empIds = this.parseCsvNumbers(params.employees);
    if (empIds.length > 0)
      qb.andWhere('sale_by.id IN (:...empIds)', { empIds });

    const deptIds = this.parseCsvNumbers(params.departments);
    if (deptIds.length > 0) {
      qb.andWhere(
        `sale_by_departments.id IN (:...deptIds)
         AND sale_by_departments.server_ip IS NOT NULL
         AND TRIM(sale_by_departments.server_ip) <> ''`,
        { deptIds },
      );
    }

    const productIds = this.parseCsvNumbers(params.products);
    if (productIds.length > 0)
      qb.andWhere('details.product_id IN (:...productIds)', { productIds });

    let rows = await qb.getMany();

    // Blacklist filtering: non-admins
    const roleNames = (params.user?.roles || []).map((r: any) =>
      typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
    );
    const isAdmin = roleNames.includes('admin');
    if (!isAdmin) {
      const allowedIds2 = await this.getUserIdsByRole(params.user);
      const isManager = roleNames.some((r: string) => r.startsWith('manager-'));
      if (isManager) {
        const map =
          await this.orderBlacklistService.getBlacklistedContactsForUsers(
            allowedIds2 || [params.user.id],
          );
        const bl = new Set<string>();
        for (const set of map.values()) for (const id of set) bl.add(id);
        rows = rows.filter((od) => {
          const cid = this.extractCustomerIdFromMetadata(od.metadata);
          return !cid || !bl.has(cid);
        });
      } else {
        const list =
          await this.orderBlacklistService.getBlacklistedContactsForUser(
            params.user.id,
          );
        const bl = new Set(list);
        rows = rows.filter((od) => {
          const cid = this.extractCustomerIdFromMetadata(od.metadata);
          return !cid || !bl.has(cid);
        });
      }
    }

    // Map to response rows
    const resultRows = rows.map((od) => {
      const revenue = (od.quantity || 0) * (od.unit_price || 0);
      const customerId = this.extractCustomerIdFromMetadata(od.metadata);
      const dynamicExtended = this.calcDynamicExtended(
        od.created_at || null,
        od.extended,
      );
      return {
        id: od.id,
        orderId: od.order_id,
        productId: od.product_id || null,
        productName: od.raw_item || null,
        status: String(od.status),
        quantity: od.quantity || 0,
        unit_price: od.unit_price || 0,
        revenue,
        sale_by: {
          id: od.order?.sale_by?.id,
          fullName: od.order?.sale_by?.fullName || od.order?.sale_by?.username,
        },
        customer: { id: customerId, name: od.customer_name || null },
        created_at:
          od.created_at?.toISOString?.() ||
          new Date(od.created_at).toISOString(),
        dynamicExtended,
      };
    });

    return {
      period: {
        period: normalizedPeriod,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      rows: resultRows,
    };
  }

  async findAllTrashedPaginated(
    user: any,
    options?: {
      page?: number;
      pageSize?: number;
      search?: string;
      employees?: string; // csv of userIds
      departments?: string; // csv of department ids (string or number)
      products?: string; // csv of product ids
      sortField?: 'quantity' | 'unit_price' | null;
      sortDirection?: 'asc' | 'desc' | null;
    },
  ): Promise<{
    data: OrderDetail[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, Number(options?.page) || 1);
    const pageSize = Math.max(
      1,
      Math.min(Number(options?.pageSize) || 10, 10000),
    );

    const qb = this.orderDetailRepository
      .createQueryBuilder('details')
      .withDeleted()
      .leftJoinAndSelect('details.order', 'order')
      .leftJoinAndSelect('details.product', 'product')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .where('details.deleted_at IS NOT NULL');

    // Permission scoping
    const allowedUserIds = await this.getUserIdsByRole(user);
    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) {
        qb.andWhere('1 = 0');
      } else {
        qb.andWhere('sale_by.id IN (:...userIds)', { userIds: allowedUserIds });
      }
    }

    // Employees filter (within allowed scope)
    if (options?.employees) {
      const ids = options.employees
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s)
        .map((s) => Number(s))
        .filter((n) => !Number.isNaN(n));
      if (ids.length > 0) {
        qb.andWhere('sale_by.id IN (:...empIds)', { empIds: ids });
      }
    }

    // Departments filter
    if (options?.departments) {
      const deptIds = options.departments
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s)
        .map((s) => Number(s))
        .filter((n) => !Number.isNaN(n));
      if (deptIds.length > 0) {
        qb.andWhere(
          'EXISTS (SELECT 1 FROM users_departments_ud ud WHERE ud.user_id = sale_by.id AND ud.department_id IN (:...deptIds))',
          { deptIds },
        );
      }
    }

    // Products filter
    if (options?.products) {
      const productIds = options.products
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s)
        .map((s) => Number(s))
        .filter((n) => !Number.isNaN(n));
      if (productIds.length > 0) {
        qb.andWhere('details.product_id IN (:...productIds)', { productIds });
      }
    }

    // Search filter
    if (options?.search && options.search.trim()) {
      const search = `%${options.search.trim()}%`;
      qb.andWhere(
        'LOWER(details.customer_name) LIKE LOWER(:search) OR LOWER(details.raw_item) LIKE LOWER(:search) OR CAST(details.id AS CHAR) LIKE :search',
        { search },
      );
    }

    // Sorting
    const sortField = options?.sortField;
    const sortDirection = (options?.sortDirection || 'desc').toUpperCase() as
      | 'ASC'
      | 'DESC';
    if (sortField === 'quantity') {
      qb.orderBy('details.quantity', sortDirection);
    } else if (sortField === 'unit_price') {
      qb.orderBy('details.unit_price', sortDirection);
    } else {
      qb.orderBy('details.deleted_at', 'DESC');
    }

    // Pagination
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [rows, total] = await qb.getManyAndCount();

    // Blacklist filtering for non-admins (same logic as active list)
    let filtered = rows;
    if (user && user.roles && user.roles.length > 0) {
      const roleNames = (user.roles || []).map((r: any) =>
        typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
      );
      const isAdmin = roleNames.includes('admin');
      const isManager = roleNames.some((r: string) => r.startsWith('manager-'));
      if (!isAdmin) {
        let blacklistedSet = new Set<string>();
        if (isManager) {
          const userIds = Array.isArray(allowedUserIds)
            ? allowedUserIds
            : [user.id];
          const map =
            await this.orderBlacklistService.getBlacklistedContactsForUsers(
              userIds,
            );
          for (const set of map.values())
            for (const id of set) blacklistedSet.add(id);
        } else {
          const list =
            await this.orderBlacklistService.getBlacklistedContactsForUser(
              user.id,
            );
          for (const id of list) blacklistedSet.add(id);
        }
        if (blacklistedSet.size > 0) {
          filtered = filtered.filter((od) => {
            const customerId = this.extractCustomerIdFromMetadata(od.metadata);
            return !customerId || !blacklistedSet.has(customerId);
          });
        }
      }
    }

    return { data: filtered, total, page, pageSize };
  }

  async bulkRestore(ids: number[], user: any): Promise<{ restored: number }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { restored: 0 };
    }

    // Only restore items owned by current user and actually soft-deleted
    const items = await this.orderDetailRepository
      .createQueryBuilder('details')
      .withDeleted()
      .leftJoinAndSelect('details.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .where('details.id IN (:...ids)', { ids })
      .andWhere('sale_by.id = :userId', { userId: user.id })
      .andWhere('details.deleted_at IS NOT NULL')
      .getMany();

    if (items.length === 0) return { restored: 0 };

    const msPerDay = 24 * 60 * 60 * 1000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Restore first to clear deleted_at
    await this.orderDetailRepository.restore(items.map((i) => i.id));

    // Clear reason and recalc extended per item
    for (const od of items) {
      try {
        const created = new Date(od.created_at);
        created.setHours(0, 0, 0, 0);
        const deltaDays = Math.floor(
          (today.getTime() - created.getTime()) / msPerDay,
        );
        const newExtended = Math.max(4, deltaDays + 4);
        await this.orderDetailRepository.update(od.id, {
          reason: '',
          extended: newExtended,
        });
      } catch (e) {
        // fallback: at least clear reason
        await this.orderDetailRepository.update(od.id, { reason: '' });
      }
    }

    return { restored: items.length };
  }

  // ================= Hidden (Ẩn) flows =================
  async hide(id: number, reason: string, user: any): Promise<void> {
    // Only owner can hide
    const existing = await this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoin('details.order', 'order')
      .leftJoin('order.sale_by', 'sale_by')
      .where('details.id = :id', { id })
      .andWhere('sale_by.id = :userId', { userId: user.id })
      .getOne();
    if (!existing) return;
    await this.orderDetailRepository.update(id, {
      reason: reason || '',
      hidden_at: new Date(),
    });
  }

  async unhide(id: number, user: any): Promise<boolean> {
    // Only owner can unhide
    const existing = await this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoin('details.order', 'order')
      .leftJoin('order.sale_by', 'sale_by')
      .where('details.id = :id', { id })
      .andWhere('sale_by.id = :userId', { userId: user.id })
      .andWhere('details.hidden_at IS NOT NULL')
      .getOne();

    if (!existing) return false;

    await this.orderDetailRepository.update(id, {
      hidden_at: null,
    });

    return true;
  }

  async bulkHide(
    ids: number[],
    reason: string,
    user: any,
  ): Promise<{ hidden: number }> {
    const orderDetails = await this.orderDetailRepository
      .createQueryBuilder('orderDetail')
      .leftJoinAndSelect('orderDetail.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .where('orderDetail.id IN (:...ids)', { ids })
      .andWhere('sale_by.id = :userId', { userId: user.id })
      .getMany();

    if (orderDetails.length === 0) {
      return { hidden: 0 };
    }

    await this.orderDetailRepository
      .createQueryBuilder()
      .update(OrderDetail)
      .set({ reason: reason || '', hidden_at: () => 'CURRENT_TIMESTAMP' })
      .where('id IN (:...ids)', { ids: orderDetails.map((od) => od.id) })
      .execute();

    return { hidden: orderDetails.length };
  }

  async bulkUnhide(ids: number[], user: any): Promise<{ unhidden: number }> {
    if (!Array.isArray(ids) || ids.length === 0) return { unhidden: 0 };

    const items = await this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoin('details.order', 'order')
      .leftJoin('order.sale_by', 'sale_by')
      .where('details.id IN (:...ids)', { ids })
      .andWhere('sale_by.id = :userId', { userId: user.id })
      .andWhere('details.hidden_at IS NOT NULL')
      .getMany();

    if (items.length === 0) return { unhidden: 0 };

    await this.orderDetailRepository
      .createQueryBuilder()
      .update(OrderDetail)
      .set({ hidden_at: null })
      .where('id IN (:...ids)', { ids: items.map((i) => i.id) })
      .execute();

    return { unhidden: items.length };
  }

  async findAllHiddenPaginated(
    user: any,
    options?: HiddenOrderOptions,
  ): Promise<{
    data: OrderDetail[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, Number(options?.page) || 1);
    const pageSize = Math.max(
      1,
      Math.min(Number(options?.pageSize) || 10, 10000),
    );

    const qb = this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoinAndSelect('details.order', 'order')
      .leftJoinAndSelect('details.product', 'product')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .leftJoinAndSelect('sale_by.departments', 'sale_by_departments')
      .where('details.hidden_at IS NOT NULL');

    // ✅ Permission scoping (giữ nguyên logic hiện tại)
    const allowedUserIds = await this.getUserIdsByRole(user);
    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) {
        qb.andWhere('1 = 0');
      } else {
        qb.andWhere('sale_by.id IN (:...userIds)', { userIds: allowedUserIds });
      }
    }

    if (options?.search && options.search.trim()) {
      const searchTerm = `%${options.search.trim()}%`;
      qb.andWhere(
        `(
        CAST(details.id AS CHAR) LIKE :search 
        OR LOWER(details.raw_item) LIKE LOWER(:search)
        OR LOWER(product.productName) LIKE LOWER(:search)
        OR LOWER(details.customer_name) LIKE LOWER(:search)
      )`,
        { search: searchTerm },
      );
    }

    // ✅ Filter 1: Employees
    if (options?.employees) {
      const empIds = options.employees
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => !Number.isNaN(n));
      if (empIds.length > 0) {
        qb.andWhere('sale_by.id IN (:...empIds)', { empIds });
      }
    }

    // ✅ Filter 2: Departments
    if (options?.departments) {
      const deptIds = options.departments
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => !Number.isNaN(n));
      if (deptIds.length > 0) {
        qb.andWhere(
          `
        sale_by_departments.id IN (:...deptIds)
        AND sale_by_departments.server_ip IS NOT NULL
        AND TRIM(sale_by_departments.server_ip) <> ''
      `,
          { deptIds },
        );
      }
    }

    // ✅ Filter 3: Status (hỗ trợ multiple statuses)
    if (options?.status && options.status.trim()) {
      if (options.status.includes(',')) {
        // Multiple statuses
        const statusArray = options.status
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s);
        if (statusArray.length > 0) {
          qb.andWhere('details.status IN (:...statuses)', {
            statuses: statusArray,
          });
        }
      } else {
        // Single status
        qb.andWhere('details.status = :status', { status: options.status });
      }
    }

    // ✅ Filter 4: Hidden Date Range
    if (options?.hiddenDateRange?.start && options?.hiddenDateRange?.end) {
      const startDate = new Date(options.hiddenDateRange.start);
      const endDate = new Date(options.hiddenDateRange.end);
      endDate.setHours(23, 59, 59, 999);

      qb.andWhere('details.hidden_at BETWEEN :hiddenStart AND :hiddenEnd', {
        hiddenStart: startDate,
        hiddenEnd: endDate,
      });
    }

    // ✅ Sorting
    const sortField = options?.sortField;
    const sortDirection = (options?.sortDirection || 'desc').toUpperCase() as
      | 'ASC'
      | 'DESC';

    if (sortField === 'quantity') {
      qb.orderBy('details.quantity', sortDirection);
    } else if (sortField === 'unit_price') {
      qb.orderBy('details.unit_price', sortDirection);
    } else if (sortField === 'hidden_at') {
      qb.orderBy('details.hidden_at', sortDirection);
    } else {
      // Mặc định sort theo ngày ẩn mới nhất
      qb.orderBy('details.hidden_at', 'DESC');
    }

    // ✅ Pagination
    qb.skip((page - 1) * pageSize).take(pageSize);
    const [rows, total] = await qb.getManyAndCount();

    // ✅ Apply blacklist filtering (giữ nguyên logic cũ)
    let filtered = rows;
    if (user && user.roles && user.roles.length > 0) {
      const roleNames = (user.roles || []).map((r: any) =>
        typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
      );
      const isAdmin = roleNames.includes('admin');
      const isManager = roleNames.some((r: string) => r.startsWith('manager-'));

      if (!isAdmin) {
        let blacklistedSet = new Set<string>();

        if (isManager) {
          const userIds = Array.isArray(allowedUserIds)
            ? allowedUserIds
            : [user.id];
          const map =
            await this.orderBlacklistService.getBlacklistedContactsForUsers(
              userIds,
            );
          for (const set of map.values()) {
            for (const id of set) blacklistedSet.add(id);
          }
        } else {
          const list =
            await this.orderBlacklistService.getBlacklistedContactsForUser(
              user.id,
            );
          for (const id of list) blacklistedSet.add(id);
        }

        if (blacklistedSet.size > 0) {
          filtered = filtered.filter((od) => {
            const customerId = this.extractCustomerIdFromMetadata(od.metadata);
            return !customerId || !blacklistedSet.has(customerId);
          });
        }
      }
    }

    return { data: filtered, total, page, pageSize };
  }

  /**
   * Đếm số lượng khách hàng unique từ order_details
   * Sử dụng Set để loại bỏ trùng lặp hiệu quả
   */
  async getCustomerCount(filters?: {
    fromDate?: string;
    toDate?: string;
    employeeId?: number;
    departmentId?: number;
    user?: any;
  }): Promise<number> {
    const qb = this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoin('details.order', 'order')
      .leftJoin('order.sale_by', 'sale_by')
      .leftJoin('sale_by.departments', 'departments')
      .select('details.customer_name', 'customer_name')
      .where('details.customer_name IS NOT NULL')
      .andWhere('details.customer_name != :empty', { empty: '' })
      .andWhere('details.deleted_at IS NULL');

    // Thêm logic phân quyền cho role "view"
    if (filters?.user) {
      const allowedUserIds = await this.getUserIdsByRole(filters.user);
      if (allowedUserIds !== null) {
        if (allowedUserIds.length === 0) {
          return 0; // Không có quyền xem dữ liệu nào
        }
        qb.andWhere('sale_by.id IN (:...allowedUserIds)', { allowedUserIds });
      }
    }

    // Filter theo thời gian
    if (filters?.fromDate) {
      qb.andWhere('details.created_at >= :fromDate', { fromDate: filters.fromDate });
    }
    if (filters?.toDate) {
      qb.andWhere('details.created_at <= :toDate', { toDate: filters.toDate });
    }

    // Filter theo nhân viên
    if (filters?.employeeId) {
      qb.andWhere('sale_by.id = :employeeId', { employeeId: filters.employeeId });
    }

    // Filter theo phòng ban
    if (filters?.departmentId) {
      qb.andWhere('departments.id = :departmentId', { departmentId: filters.departmentId });
    }

    const customerNames = await qb.getRawMany();

    // Sử dụng Set để đếm unique customers
    const uniqueCustomers = new Set(
      customerNames
        .map(item => item.customer_name)
        .filter(name => name && name.trim() !== '')
    );

    return uniqueCustomers.size;
  }

  /**
   * Lấy danh sách khách hàng unique có phân trang
   */
  async getDistinctCustomers(params: {
    fromDate?: string;
    toDate?: string;
    employeeId?: number;
    departmentId?: number;
    page: number;
    pageSize: number;
    user?: any;
  }): Promise<{ data: { customer_name: string; orders: number }[]; total: number; page: number; pageSize: number }> {
    const qb = this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoin('details.order', 'order')
      .leftJoin('order.sale_by', 'sale_by')
      .leftJoin('sale_by.departments', 'departments')
      .select('details.customer_name', 'customer_name')
      .addSelect('COUNT(details.id)', 'orders')
      .where('details.customer_name IS NOT NULL')
      .andWhere('details.customer_name != :empty', { empty: '' })
      .andWhere('details.deleted_at IS NULL')
      .groupBy('details.customer_name');

    // Thêm logic phân quyền cho role "view"
    if (params.user) {
      const allowedUserIds = await this.getUserIdsByRole(params.user);
      if (allowedUserIds !== null) {
        if (allowedUserIds.length === 0) {
          return { data: [], total: 0, page: params.page, pageSize: params.pageSize }; // Không có quyền xem dữ liệu nào
        }
        qb.andWhere('sale_by.id IN (:...allowedUserIds)', { allowedUserIds });
      }
    }

    if (params.fromDate) qb.andWhere('details.created_at >= :fromDate', { fromDate: params.fromDate });
    if (params.toDate) qb.andWhere('details.created_at <= :toDate', { toDate: params.toDate });
    if (params.employeeId) qb.andWhere('sale_by.id = :employeeId', { employeeId: params.employeeId });
    if (params.departmentId) qb.andWhere('departments.id = :departmentId', { departmentId: params.departmentId });

    // Tổng số khách (distinct) - đếm chính xác số unique customer_name
    const totalQb = this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoin('details.order', 'order')
      .leftJoin('order.sale_by', 'sale_by')
      .leftJoin('sale_by.departments', 'departments')
      .select('COUNT(DISTINCT details.customer_name)', 'cnt')
      .where('details.customer_name IS NOT NULL')
      .andWhere('details.customer_name != :empty', { empty: '' })
      .andWhere('details.deleted_at IS NULL');

    // Thêm logic phân quyền cho totalQb
    if (params.user) {
      const allowedUserIds = await this.getUserIdsByRole(params.user);
      if (allowedUserIds !== null) {
        if (allowedUserIds.length === 0) {
          return { data: [], total: 0, page: params.page, pageSize: params.pageSize }; // Không có quyền xem dữ liệu nào
        }
        totalQb.andWhere('sale_by.id IN (:...allowedUserIds)', { allowedUserIds });
      }
    }

    if (params.fromDate) totalQb.andWhere('details.created_at >= :fromDate', { fromDate: params.fromDate });
    if (params.toDate) totalQb.andWhere('details.created_at <= :toDate', { toDate: params.toDate });
    if (params.employeeId) totalQb.andWhere('sale_by.id = :employeeId', { employeeId: params.employeeId });
    if (params.departmentId) totalQb.andWhere('departments.id = :departmentId', { departmentId: params.departmentId });

    const totalRaw = await totalQb.getRawOne<{ cnt: string | number }>();
    const totalRows = Number(totalRaw?.cnt || 0);

    // Phân trang theo nhóm distinct
    const offset = (params.page - 1) * params.pageSize;
    // Stable ordering: first by orders desc, then by name asc to avoid flicker across pages when counts tie
    qb.orderBy('orders', 'DESC')
      .addOrderBy('details.customer_name', 'ASC')
      .offset(offset)
      .limit(params.pageSize);

    const rows = await qb.getRawMany();
    const data = rows.map(r => ({ customer_name: r.customer_name, orders: Number(r.orders) || 0 }));

    return { data, total: totalRows, page: params.page, pageSize: params.pageSize };
  }
}
