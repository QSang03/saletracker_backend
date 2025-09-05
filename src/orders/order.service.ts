import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, Between, Not, IsNull, In } from 'typeorm';
import { Order } from './order.entity';
import { OrderDetail } from 'src/order-details/order-detail.entity';
import { Department } from 'src/departments/department.entity';
import { User } from 'src/users/user.entity';
import { Product } from 'src/products/product.entity';
import { OrderBlacklistService } from '../order-blacklist/order-blacklist.service';
import { Logger } from '@nestjs/common';

interface OrderFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  statuses?: string;
  date?: string;
  dateRange?: { start: string; end: string };
  employee?: string;
  employees?: string;
  departments?: string;
  products?: string;
  quantity?: string;
  conversationType?: string;
  warningLevel?: string;
  sortField?:
    | 'quantity'
    | 'unit_price'
  | 'extended'
  | 'dynamicExtended'
  | 'created_at'
  | 'conversation_start'
  | 'conversation_end'
    | null;
  sortDirection?: 'asc' | 'desc' | null;
  user?: any; // truyền cả user object
  includeHidden?: string; // '1' | 'true' to include hidden items (admin only)
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @InjectRepository(OrderDetail)
    private orderDetailRepository: Repository<OrderDetail>,
    @InjectRepository(Department)
    private departmentRepository: Repository<Department>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    private orderBlacklistService: OrderBlacklistService,
  ) {}

  // =============== Stats helpers ===============
  private isAdmin(user: any): boolean {
    const roleNames = (user?.roles || []).map((r: any) =>
      typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
    );
    return roleNames.includes('admin');
  }

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
    const day = (date.getDay() + 6) % 7; // 0=Monday
    date.setDate(date.getDate() - day);
    return date;
  }

  private endOfWeekSunday(d: Date): Date {
    const start = this.startOfWeekMonday(d);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return this.endOfDay(end);
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
    const start = this.startOfQuarter(d);
    return this.endOfDay(
      new Date(start.getFullYear(), start.getMonth() + 3, 0),
    );
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
    const today = new Date();
    const p = (period || 'day').toLowerCase();

    if (p === 'custom' && dateFrom && dateTo) {
      const from = this.startOfDay(new Date(dateFrom));
      const to = this.endOfDay(new Date(dateTo));
      return { from, to, normalizedPeriod: 'custom' };
    }

    const target = date ? new Date(date) : today;
    switch (p) {
      case 'week': {
        const from = this.startOfWeekMonday(target);
        const to = this.endOfWeekSunday(target);
        return { from, to, normalizedPeriod: 'week' };
      }
      case 'month': {
        const from = this.startOfMonth(target);
        const to = this.endOfMonth(target);
        return { from, to, normalizedPeriod: 'month' };
      }
      case 'quarter': {
        const from = this.startOfQuarter(target);
        const to = this.endOfQuarter(target);
        return { from, to, normalizedPeriod: 'quarter' };
      }
      case 'day':
      default: {
        const from = this.startOfDay(target);
        const to = this.endOfDay(target);
        return { from, to, normalizedPeriod: 'day' };
      }
    }
  }

  private getPreviousPeriodRange(
    period: 'day' | 'week' | 'month' | 'quarter' | 'custom',
    from: Date,
    to: Date,
  ): { from: Date; to: Date } {
    const diffMs = to.getTime() - from.getTime() + 1;
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - diffMs + 1);
    return { from: this.startOfDay(prevFrom), to: this.endOfDay(prevTo) };
  }

  async findAll(): Promise<Order[]> {
    return this.orderRepository.find({
      relations: ['details', 'sale_by', 'sale_by.departments'],
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

        /**
     * Logic xử lý role PM:
     * - Nếu chỉ có role PM gốc → trả về mảng rỗng (không có dữ liệu)
     * - Nếu có role pm-{department} → lọc users theo phòng ban đó
     */
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
        .find({
          where: departmentSlugs.map((slug) => ({ slug, deletedAt: IsNull() })),
        })
        .then((departments) =>
          departments.filter(
            (dep) => dep.server_ip && dep.server_ip.trim() !== '',
          ),
        );

      if (departments.length > 0) {
        const departmentIds = departments.map((d) => d.id);

        if (departmentIds.length === 0) return [];

        const usersInDepartments = await this.userRepository
          .createQueryBuilder('user')
          .leftJoin('user.departments', 'dept')
          .where('dept.id IN (:...departmentIds)', { departmentIds })
          .andWhere('user.deletedAt IS NULL')
          .getMany();

        return usersInDepartments.map((u) => u.id);
      }
      return []; // PM không có department hợp lệ
    }

    const managerRoles = roleNames.filter((r: string) =>
      r.startsWith('manager-'),
    );
    if (managerRoles.length > 0) {
      // Manager: lấy tất cả user trong phòng ban CÓ SERVER_IP
      const departmentSlugs = managerRoles.map((r: string) =>
        r.replace('manager-', ''),
      );

      const departments = await this.departmentRepository
        .find({
          where: departmentSlugs.map((slug) => ({ slug, deletedAt: IsNull() })),
        })
        .then((departments) =>
          departments.filter(
            (dep) => dep.server_ip && dep.server_ip.trim() !== '',
          ),
        );

      if (departments.length > 0) {
        const departmentIds = departments.map((d) => d.id);

        if (departmentIds.length === 0) return [];

        // Lấy users thuộc các department có server_ip
        const usersInDepartments = await this.userRepository
          .createQueryBuilder('user')
          .leftJoin('user.departments', 'dept')
          .where('dept.id IN (:...departmentIds)', { departmentIds })
          .andWhere('user.deletedAt IS NULL')
          .getMany();

        return usersInDepartments.map((u) => u.id);
      }
      return []; // Manager không có department hợp lệ (có server_ip)
    }

    // User thường: chỉ xem của chính họ
    return [user.id];
  }

  // Helper method để parse customer_id từ metadata JSON
  private extractCustomerIdFromMetadata(metadata: any): string | null {
    try {
      if (typeof metadata === 'string') {
        const parsed = JSON.parse(metadata);
        const customerId = parsed.customer_id || null;
        return customerId;
      } else if (typeof metadata === 'object' && metadata !== null) {
        const customerId = metadata.customer_id || null;
        return customerId;
      }
      return null;
    } catch (error) {
      this.logger.warn(
        `Error parsing metadata: ${error.message}, metadata: ${JSON.stringify(metadata)}`,
      );
      return null;
    }
  }

  async findAllWithPermission(user?: any): Promise<Order[]> {
    const queryBuilder = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.details', 'details')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .leftJoinAndSelect('sale_by.departments', 'sale_by_departments');

    const allowedUserIds = await this.getUserIdsByRole(user);

    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) {
        queryBuilder.andWhere('1 = 0'); // Không có quyền xem gì
      } else {
        queryBuilder.andWhere('order.sale_by IN (:...userIds)', {
          userIds: allowedUserIds,
        });
      }
    }
    // Admin (allowedUserIds === null) không có điều kiện gì

    return queryBuilder.getMany();
  }

  async getFilterOptions(user?: any): Promise<{
    departments: Array<{
      value: number;
      label: string;
      users: Array<{ value: number; label: string }>;
    }>;
    products: Array<{ value: number; label: string }>;
  }> {
    const result: {
      departments: Array<{
        value: number;
        label: string;
        users: Array<{ value: number; label: string }>;
      }>;
      products: Array<{ value: number; label: string }>;
    } = {
      departments: [],
      products: [],
    };

    // Lấy danh sách sản phẩm
    const products = await this.productRepository.find({
      select: ['id', 'productName'],
      order: { productName: 'ASC' },
    });

    result.products = products.map((p) => ({
      value: p.id,
      label: p.productName,
    }));

    // Phân quyền cho departments và users
    if (!user) return result;

    const roleNames = (user.roles || []).map((r: any) =>
      typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
    );

  const isAdmin = roleNames.includes('admin');
  const isViewRole = roleNames.includes('view');

  // Nếu không phải admin, lấy danh sách user ids có role 'view' để loại bỏ khỏi kết quả
  let viewUserIds = new Set<number>();
  if (!isAdmin) {
    try {
      const raw = await this.userRepository
        .createQueryBuilder('u')
        .innerJoin('u.roles', 'r')
        .where('LOWER(r.name) = :v', { v: 'view' })
        .select('u.id', 'id')
        .getRawMany();
      raw.forEach((r: any) => {
        const id = Number(r.id ?? r.u_id ?? r.uId ?? r.user_id ?? r.userId);
        if (!isNaN(id)) viewUserIds.add(id);
      });
    } catch (e) {
      // ignore errors - fallback to empty set
    }
  }

  if (isAdmin) {
      // Admin: lấy tất cả departments có server_ip khác null và khác rỗng
      const departments = await this.departmentRepository
        .find({
          where: {
            deletedAt: IsNull(),
            server_ip: Not(IsNull()),
          },
          relations: ['users'],
          order: { name: 'ASC' },
        })
        .then((departments) =>
          departments
            .filter((dep) => dep.server_ip && dep.server_ip.trim() !== '')
            .map((dep) => ({
              ...dep,
              users: (dep.users || []).filter((u) => !u.deletedAt),
            })),
        );
      result.departments = departments.map((dept) => ({
        value: dept.id,
        label: dept.name,
        slug: dept.slug,
        users: (dept.users || [])
          .filter((u) => {
            const uid = Number(u.id);
            return !u.deletedAt && (isAdmin || !viewUserIds.has(uid) || uid === Number(user.id));
          })
          .map((u) => ({
            value: u.id,
            label: u.fullName || u.username,
          })),
      }));
  } else if (isViewRole) {
      // Role view: chỉ lấy departments được phân quyền
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
            .andWhere('dept.deletedAt IS NULL')
            .getMany();
          
          departmentIds = departments.map((d) => d.id);
        }
      }
      
      if (departmentIds.length > 0) {
        const departments = await this.departmentRepository
          .find({
            where: {
              id: In(departmentIds),
              deletedAt: IsNull(),
              server_ip: Not(IsNull()),
            },
            relations: ['users'],
            order: { name: 'ASC' },
          })
          .then((departments) =>
            departments
              .filter((dep) => dep.server_ip && dep.server_ip.trim() !== '')
              .map((dep) => ({
                ...dep,
                users: (dep.users || []).filter((u) => !u.deletedAt),
              })),
          );
        result.departments = departments.map((dept) => ({
          value: dept.id,
          label: dept.name,
          slug: dept.slug,
          users: (dept.users || [])
            .filter((u) => {
              const uid = Number(u.id);
              return !u.deletedAt && (isAdmin || !viewUserIds.has(uid) || uid === Number(user.id));
            })
            .map((u) => ({
              value: u.id,
              label: u.fullName || u.username,
            })),
        }));
      }
    } else {
      const pmRoles = roleNames.filter((r: string) => r.startsWith('pm-'));
      const managerRoles = roleNames.filter((r: string) => r.startsWith('manager-'));

      if (pmRoles.length > 0) {
        // PM: lấy departments theo pm-{slug} và tất cả users trong đó (có server_ip hợp lệ)
        const departmentSlugs = pmRoles.map((r: string) => r.replace('pm-', ''));

        const departments = await this.departmentRepository
          .find({
            where: departmentSlugs.map((slug) => ({
              slug,
              deletedAt: IsNull(),
              server_ip: Not(IsNull()),
            })),
            relations: ['users'],
            order: { name: 'ASC' },
          })
          .then((departments) =>
            departments
              .filter((dep) => dep.server_ip && dep.server_ip.trim() !== '')
              .map((dep) => ({
                ...dep,
                users: (dep.users || []).filter((u) => !u.deletedAt),
              })),
          );

        result.departments = departments.map((dept) => ({
          value: dept.id,
          label: dept.name,
          slug: dept.slug,
          users: (dept.users || [])
            .filter((u) => {
              const uid = Number(u.id);
              return !u.deletedAt && (isAdmin || !viewUserIds.has(uid) || uid === Number(user.id));
            })
            .map((u) => ({
              value: u.id,
              label: u.fullName || u.username,
            })),
        }));
      } else if (managerRoles.length > 0) {
        // Manager: chỉ lấy department của mình và users trong đó, chỉ lấy department có server_ip hợp lệ
        const departmentSlugs = managerRoles.map((r: string) => r.replace('manager-', ''));

        const departments = await this.departmentRepository
          .find({
            where: departmentSlugs.map((slug) => ({
              slug,
              deletedAt: IsNull(),
              server_ip: Not(IsNull()),
            })),
            relations: ['users'],
            order: { name: 'ASC' },
          })
          .then((departments) =>
            departments
              .filter((dep) => dep.server_ip && dep.server_ip.trim() !== '')
              .map((dep) => ({
                ...dep,
                users: (dep.users || []).filter((u) => !u.deletedAt),
              })),
          );

        result.departments = departments.map((dept) => ({
          value: dept.id,
          label: dept.name,
          slug: dept.slug,
          users: (dept.users || [])
            .filter((u) => {
              const uid = Number(u.id);
              return !u.deletedAt && (isAdmin || !viewUserIds.has(uid) || uid === Number(user.id));
            })
            .map((u) => ({
              value: u.id,
              label: u.fullName || u.username,
            })),
        }));
      } else {
        // User thường: chỉ thấy chính mình và department của mình, chỉ lấy department có server_ip hợp lệ
        const currentUser = await this.userRepository.findOne({
          where: {
            id: user.id,
            deletedAt: IsNull(),
          },
          relations: ['departments'],
        });

        if (currentUser && currentUser.departments) {
          // Lọc lại departments có server_ip hợp lệ
          const validDepartments = currentUser.departments.filter(
            (dept) => !!dept.server_ip,
          );
          result.departments = validDepartments.map((dept) => ({
            value: dept.id,
            label: dept.name,
            slug: dept.slug,
            users: [
              {
                value: currentUser.id,
                label: currentUser.fullName || currentUser.username,
              },
            ].filter((u) => {
              const uid = Number(u.value);
              return isAdmin || !viewUserIds.has(uid) || uid === Number(user.id);
            }),
          }));
        }
      }
    }

    return result;
  }

  // Thêm method helper để tính toán dynamic extended
  private calcDynamicExtended(
    createdAt: Date | null,
    originalExtended: number | null,
  ): number | null {
    try {
      if (!createdAt || originalExtended === null) {
        return typeof originalExtended === 'number' ? originalExtended : null;
      }

      const createdDate = new Date(createdAt);
      createdDate.setHours(0, 0, 0, 0); // Reset time to start of day

      const expiredDate = new Date(createdDate);
      expiredDate.setDate(expiredDate.getDate() + originalExtended);

      const today = new Date();
      today.setHours(0, 0, 0, 0); // Reset time to start of day

      const diffTime = expiredDate.getTime() - today.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      return diffDays;
    } catch (error) {
      return typeof originalExtended === 'number' ? originalExtended : null;
    }
  }

  // Updated findAllPaginated method với dynamic extended calculation và sorting
  // async findAllPaginated(filters: OrderFilters): Promise<{
  //   data: OrderDetail[];
  //   total: number;
  //   page: number;
  //   pageSize: number;
  // }> {
  //   const {
  //     page,
  //     pageSize,
  //     search,
  //     status,
  //     date,
  //     dateRange,
  //     employee,
  //     employees,
  //     departments,
  //     products,
  //     warningLevel,
  //     sortField,
  //     sortDirection,
  //     user,
  //   } = filters;
  //   const skip = (page - 1) * pageSize;

  //   const queryBuilder = this.orderDetailRepository
  //     .createQueryBuilder('details')
  //     .leftJoinAndSelect('details.order', 'order')
  //     .leftJoinAndSelect('details.product', 'product')
  //     .leftJoinAndSelect('order.sale_by', 'sale_by')
  //     .leftJoinAndSelect('sale_by.departments', 'sale_by_departments');

  //   // Phân quyền xem
  //   const allowedUserIds = await this.getUserIdsByRole(user);
  //   if (allowedUserIds !== null) {
  //     if (allowedUserIds.length === 0) {
  //       queryBuilder.andWhere('1 = 0');
  //     } else {
  //       queryBuilder.andWhere('sale_by.id IN (:...userIds)', {
  //         userIds: allowedUserIds,
  //       });
  //     }
  //   }

  //   // Apply filters as before
  //   if (search) {
  //     queryBuilder.andWhere(
  //       '(CAST(details.id AS CHAR) LIKE :search OR details.customer_name LIKE :search OR details.raw_item LIKE :search)',
  //       { search: `%${search}%` },
  //     );
  //   }

  //   if (status) {
  //     queryBuilder.andWhere('details.status = :status', { status });
  //   }

  //   if (date) {
  //     const startDate = new Date(date);
  //     const endDate = new Date(date);
  //     endDate.setHours(23, 59, 59, 999);
  //     queryBuilder.andWhere(
  //       'order.created_at BETWEEN :startDate AND :endDate',
  //       { startDate, endDate },
  //     );
  //   }

  //   if (dateRange && dateRange.start && dateRange.end) {
  //     const startDate = new Date(dateRange.start);
  //     const endDate = new Date(dateRange.end);
  //     endDate.setHours(23, 59, 59, 999);
  //     queryBuilder.andWhere(
  //       'order.created_at BETWEEN :rangeStart AND :rangeEnd',
  //       { rangeStart: startDate, rangeEnd: endDate },
  //     );
  //   }

  //   if (employee) {
  //     queryBuilder.andWhere('sale_by.id = :employee', { employee });
  //   }

  //   if (employees) {
  //     const employeeIds = employees
  //       .split(',')
  //       .map((id) => parseInt(id.trim(), 10))
  //       .filter((id) => !isNaN(id));
  //     if (employeeIds.length > 0) {
  //       queryBuilder.andWhere('sale_by.id IN (:...employeeIds)', {
  //         employeeIds,
  //       });
  //     }
  //   }

  //   if (departments) {
  //     const departmentIds = departments
  //       .split(',')
  //       .map((id) => parseInt(id.trim(), 10))
  //       .filter((id) => !isNaN(id));
  //     if (departmentIds.length > 0) {
  //       queryBuilder.andWhere(
  //         `
  //       sale_by_departments.id IN (:...departmentIds)
  //       AND sale_by_departments.server_ip IS NOT NULL
  //       AND TRIM(sale_by_departments.server_ip) <> ''
  //     `,
  //         { departmentIds },
  //       );
  //     }
  //   }

  //   if (products) {
  //     const productIds = products
  //       .split(',')
  //       .map((id) => parseInt(id.trim(), 10))
  //       .filter((id) => !isNaN(id));
  //     if (productIds.length > 0) {
  //       queryBuilder.andWhere('details.product_id IN (:...productIds)', {
  //         productIds,
  //       });
  //     }
  //   }

  //   if (warningLevel) {
  //     const levels = warningLevel
  //       .split(',')
  //       .map((level) => parseInt(level.trim(), 10))
  //       .filter((level) => !isNaN(level));
  //     if (levels.length > 0) {
  //       queryBuilder.andWhere('details.extended IN (:...levels)', { levels });
  //     }
  //   }

  //   // Chuẩn bị data blacklist theo role
  //   let managerBlacklistMap: Map<number, Set<string>> | undefined;
  //   let userBlacklisted: string[] | undefined;

  //   if (user && user.roles) {
  //     const roleNames = (user.roles || []).map((r: any) =>
  //       typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
  //     );
  //     const isAdmin = roleNames.includes('admin');
  //     const isManager = roleNames.some((r: string) => r.startsWith('manager-'));

  //     if (!isAdmin) {
  //       if (isManager) {
  //         // Manager: không được thấy các đơn của khách bị blacklist bởi bất kỳ user nào trong phạm vi họ có thể xem (allowedUserIds)
  //         managerBlacklistMap =
  //           await this.orderBlacklistService.getBlacklistedContactsForUsers(
  //             allowedUserIds || [],
  //           );
  //       } else {
  //         // User: ẩn các đơn của khách nằm trong blacklist của chính họ
  //         userBlacklisted =
  //           await this.orderBlacklistService.getBlacklistedContactsForUser(
  //             user.id,
  //           );
  //       }
  //     }
  //   }

  //   // LUÔN lấy tất cả data để áp dụng unified sorting
  //   const allData = await queryBuilder.getMany();

  //   // Tính calcDynamicExtended cho tất cả data
  //   const dataWithDynamicExtended = allData.map((orderDetail) => ({
  //     ...orderDetail,
  //     dynamicExtended: this.calcDynamicExtended(
  //       orderDetail.created_at || null,
  //       orderDetail.extended,
  //     ),
  //   }));

  //   // Áp dụng blacklist filter theo role
  //   let filteredData = dataWithDynamicExtended;

  //   if (user && !roleNamesIncludes(user, 'admin')) {
  //     if (roleNamesSome(user, (r) => r.startsWith('manager-'))) {
  //       if (managerBlacklistMap && (allowedUserIds?.length || 0) > 0) {
  //         const blacklistedSet = new Set<string>();
  //         for (const uid of allowedUserIds!) {
  //           const set = managerBlacklistMap.get(uid);
  //           if (set) for (const cid of set) blacklistedSet.add(cid);
  //         }
  //         const filterFn = (od: OrderDetail) => {
  //           const cid = this.extractCustomerIdFromMetadata(od.metadata);
  //           return !cid || !blacklistedSet.has(cid);
  //         };
  //         filteredData = filteredData.filter(filterFn);
  //       }
  //     } else {
  //       if (userBlacklisted && userBlacklisted.length > 0) {
  //         const set = new Set(userBlacklisted);
  //         const filterFn = (od: OrderDetail) => {
  //           const cid = this.extractCustomerIdFromMetadata(od.metadata);
  //           return !cid || !set.has(cid);
  //         };
  //         filteredData = filteredData.filter(filterFn);
  //       }
  //     }
  //   }

  //   const actualSortDirection =
  //     sortDirection?.toLowerCase() === 'asc' ? 'asc' : 'desc';

  //   // LUÔN sort theo calcDynamicExtended
  //   if (sortField === 'created_at') {
  //     // Sort theo created_at
  //     filteredData.sort((a, b) => {
  //       const aTime = new Date(a.created_at || 0).getTime();
  //       const bTime = new Date(b.created_at || 0).getTime();
  //       return actualSortDirection === 'asc' ? aTime - bTime : bTime - aTime;
  //     });
  //   } else if (sortField === 'quantity') {
  //     // ✅ THÊM: Sort theo quantity
  //     filteredData.sort((a, b) => {
  //       const aQty = a.quantity || 0;
  //       const bQty = b.quantity || 0;
  //       const qtyDiff =
  //         actualSortDirection === 'asc' ? aQty - bQty : bQty - aQty;

  //       // Nếu quantity bằng nhau, sort theo created_at giảm dần
  //       if (qtyDiff === 0) {
  //         const aTime = new Date(a.created_at || 0).getTime();
  //         const bTime = new Date(b.created_at || 0).getTime();
  //         return bTime - aTime;
  //       }
  //       return qtyDiff;
  //     });
  //   } else if (sortField === 'unit_price') {
  //     // ✅ THÊM: Sort theo unit_price
  //     filteredData.sort((a, b) => {
  //       const aPrice = a.unit_price || 0;
  //       const bPrice = b.unit_price || 0;
  //       const priceDiff =
  //         actualSortDirection === 'asc' ? aPrice - bPrice : bPrice - aPrice;

  //       // Nếu unit_price bằng nhau, sort theo created_at giảm dần
  //       if (priceDiff === 0) {
  //         const aTime = new Date(a.created_at || 0).getTime();
  //         const bTime = new Date(b.created_at || 0).getTime();
  //         return bTime - aTime;
  //       }
  //       return priceDiff;
  //     });
  //   } else {
  //     // Mặc định: Sort theo dynamicExtended
  //     filteredData.sort((a, b) => {
  //       const aExtended =
  //         a.dynamicExtended !== null ? a.dynamicExtended : -999999;
  //       const bExtended =
  //         b.dynamicExtended !== null ? b.dynamicExtended : -999999;

  //       const extendedDiff =
  //         actualSortDirection === 'asc'
  //           ? aExtended - bExtended
  //           : bExtended - aExtended;

  //       if (extendedDiff === 0) {
  //         const aTime = new Date(a.created_at || 0).getTime();
  //         const bTime = new Date(b.created_at || 0).getTime();
  //         return bTime - aTime;
  //       }
  //       return extendedDiff;
  //     });
  //   }

  //   // Áp dụng pagination sau khi sort và filter
  //   const data = filteredData.slice(skip, skip + pageSize);
  //   const actualTotal = filteredData.length;

  //   return { data, total: actualTotal, page, pageSize };
  // }

  async findAllPaginated(filters: OrderFilters): Promise<{
    data: OrderDetail[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const {
      page,
      pageSize,
      search,
      status,
      statuses,
      date,
      dateRange,
      employee,
      employees,
      departments,
      products,
      warningLevel,
      quantity,
      sortField,
      sortDirection,
      user,
      includeHidden,
    } = filters;

    const skip = (page - 1) * pageSize;

    // Precompute blacklist lists (use service methods which are optimized)
    let blacklistForSql: string[] | undefined;
    if (user && user.roles) {
      const roleNames = (user.roles || []).map((r: any) =>
        typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
      );
      const isAdminUser = roleNames.includes('admin');
      const isManager = roleNames.some((r: string) => r.startsWith('manager-'));

      if (!isAdminUser) {
        if (isManager) {
          const allowedUserIds = (await this.getUserIdsByRole(user)) || [];
          const map = await this.orderBlacklistService.getBlacklistedContactsForUsers(
            allowedUserIds,
          );
          const merged = new Set<string>();
          for (const set of map.values()) for (const id of set) merged.add(id);
          blacklistForSql = Array.from(merged);
        } else {
          blacklistForSql = await this.orderBlacklistService.getBlacklistedContactsForUser(
            user.id,
          );
        }
      }
    }

    // Build query: compute dynamicExtended in SQL to allow filtering/sorting in DB
    // MySQL expression: DATEDIFF(DATE_ADD(DATE(details.created_at), INTERVAL COALESCE(details.extended,0) DAY), CURDATE())
    const dynamicExpr = `DATEDIFF(DATE_ADD(DATE(details.created_at), INTERVAL COALESCE(details.extended,0) DAY), CURDATE())`;

    // Compute conversation_start and conversation_end: try to extract the minimal/maximal timestamp from metadata.messages
    // We add selected fields 'conversation_start' and 'conversation_end' as DATETIME parsed from JSON timestamps
    // Robust parsing: strip fractional seconds and trailing Z if present, then parse
    // Use LEFT(...,19) to get 'YYYY-MM-DDTHH:MM:SS' which STR_TO_DATE can parse
    const convoStartExpr = `(
      SELECT MIN(STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(m.value, '$.timestamp')), 19), '%Y-%m-%dT%H:%i:%s'))
      FROM JSON_TABLE(details.metadata, '$.messages[*]' COLUMNS (value JSON PATH '$')) AS m
    )`;
    const convoEndExpr = `(
      SELECT MAX(STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(m.value, '$.timestamp')), 19), '%Y-%m-%dT%H:%i:%s'))
      FROM JSON_TABLE(details.metadata, '$.messages[*]' COLUMNS (value JSON PATH '$')) AS m
    )`;

    const qb = this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoinAndSelect('details.order', 'order')
      .leftJoinAndSelect('details.product', 'product')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .leftJoinAndSelect('sale_by.departments', 'sale_by_departments')
  .addSelect(`${dynamicExpr}`, 'dynamicExtended')
  .addSelect(convoStartExpr, 'conversation_start')
  .addSelect(convoEndExpr, 'conversation_end');

    // Permissions
    const allowedUserIds = await this.getUserIdsByRole(user);
    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) {
        return { data: [], total: 0, page, pageSize };
      }
      qb.andWhere('sale_by.id IN (:...userIds)', { userIds: allowedUserIds });
    }

    // Basic filters
    if (quantity !== undefined && quantity !== null && String(quantity).trim() !== '') {
      const minQty = parseInt(String(quantity), 10);
      if (!isNaN(minQty) && minQty > 0) qb.andWhere('details.quantity >= :minQty', { minQty });
    }

    if (search) {
      qb.andWhere(
        '(CAST(details.id AS CHAR) LIKE :search OR LOWER(details.customer_name) LIKE LOWER(:search) OR LOWER(details.raw_item) LIKE LOWER(:search))',
        { search: `%${String(search).trim()}%` },
      );
    }

    if (status && status.trim()) {
      if (status.includes(',')) {
        const statusArray = status.split(',').map((s) => s.trim()).filter((s) => s);
        if (statusArray.length > 0) qb.andWhere('details.status IN (:...statuses)', { statuses: statusArray });
      } else {
        qb.andWhere('details.status = :status', { status });
      }
    }

    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      qb.andWhere('order.created_at BETWEEN :startDate AND :endDate', { startDate, endDate });
    }

    if (dateRange && dateRange.start && dateRange.end) {
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      endDate.setHours(23, 59, 59, 999);
      qb.andWhere('order.created_at BETWEEN :rangeStart AND :rangeEnd', { rangeStart: startDate, rangeEnd: endDate });
    }

    if (employee) qb.andWhere('sale_by.id = :employee', { employee });

    if (employees) {
      const employeeIds = employees.split(',').map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id));
      if (employeeIds.length > 0) qb.andWhere('sale_by.id IN (:...employeeIds)', { employeeIds });
    }

    if (departments) {
      const departmentIds = departments.split(',').map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id));
      if (departmentIds.length > 0) {
        qb.andWhere(
          `sale_by_departments.id IN (:...departmentIds) AND sale_by_departments.server_ip IS NOT NULL AND TRIM(sale_by_departments.server_ip) <> ''`,
          { departmentIds },
        );
      }
    }

    if (products) {
      const productIds = products.split(',').map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id));
      if (productIds.length > 0) qb.andWhere('details.product_id IN (:...productIds)', { productIds });
    }

    // Hidden items
    const wantsHidden = (includeHidden || '').toString().toLowerCase();
    const includeHiddenFlag = wantsHidden === '1' || wantsHidden === 'true';
    const isAdminUser = this.isAdmin(user);
    if (!(includeHiddenFlag && isAdminUser)) {
      qb.andWhere('details.hidden_at IS NULL');
    }

    // Apply blacklist filtering in SQL when available
    if (blacklistForSql && blacklistForSql.length > 0) {
      // Use JSON_UNQUOTE to compare JSON value with plain strings
      qb.andWhere(`(details.metadata IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(details.metadata, '$.customer_id')) NOT IN (:...blacklist))`, {
        blacklist: blacklistForSql,
      });
    }

    // Warning level filter based on dynamicExtended
    if (warningLevel) {
      const levels = warningLevel.split(',').map((l) => parseInt(l.trim(), 10)).filter((n) => !isNaN(n));
      if (levels.length > 0) {
        qb.andWhere(`${dynamicExpr} IN (:...levels)`, { levels });
      }
    }

    // Sorting
    const dir = sortDirection?.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    // If no sortField provided, default to conversation_start as requested
    if (sortField === 'created_at') {
      qb.orderBy('details.created_at', dir).addOrderBy('details.id', 'DESC');
    } else if (sortField === 'conversation_start' || !sortField) {
      // Order by computed conversation_start; if null, fallback to details.created_at
      qb.orderBy('conversation_start', dir).addOrderBy('details.created_at', 'DESC');
    } else if (sortField === 'conversation_end') {
      // Order by computed conversation_end; if null, fallback to details.created_at
      qb.orderBy('conversation_end', dir).addOrderBy('details.created_at', 'DESC');
    } else if (sortField === 'quantity') {
      qb.orderBy('details.quantity', dir).addOrderBy('details.created_at', 'DESC');
    } else if (sortField === 'unit_price') {
      qb.orderBy('details.unit_price', dir).addOrderBy('details.created_at', 'DESC');
    } else {
      // default: dynamicExtended then created_at desc
      qb.orderBy('dynamicExtended', dir).addOrderBy('details.created_at', 'DESC');
    }

    // Log generated SQL for debugging filter behavior
    try {
      this.logger.debug(`OrderService.findAllPaginated - SQL: ${qb.getSql()}`);
    } catch (e) {
      // ignore if getSql fails for some QB configurations
    }

    // Pagination with count at DB level
    const [data, total] = await qb.skip(skip).take(pageSize).getManyAndCount();

    this.logger.debug(`OrderService.findAllPaginated: fetched ${data.length} rows (page ${page}) total ${total}`);

    return { data, total, page, pageSize };
  }

  async findByIdWithPermission(id: number, user?: any): Promise<Order | null> {
    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.details', 'details')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .leftJoinAndSelect('sale_by.departments', 'sale_by_departments')
      .where('order.id = :id', { id });

    const allowedUserIds = await this.getUserIdsByRole(user);
    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) return null;
      qb.andWhere('sale_by.id IN (:...userIds)', { userIds: allowedUserIds });
    }

    return qb.getOne();
  }

  async create(orderData: Partial<Order>): Promise<Order> {
    const order = this.orderRepository.create(orderData);
    return this.orderRepository.save(order);
  }

  async update(id: number, orderData: Partial<Order>): Promise<Order | null> {
    await this.orderRepository.update(id, orderData);
    return this.orderRepository.findOne({
      where: { id },
      relations: ['details', 'sale_by', 'sale_by.departments'],
    });
  }

  async delete(id: number): Promise<void> {
    await this.orderRepository.delete(id);
  }

  // =============== Stats implementations ===============
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

  async getOverviewStats(
    params: StatsParamsCommon,
  ): Promise<OverviewStatsResponse> {
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
      .leftJoinAndSelect('sale_by.departments', 'sale_by_departments')
      .where('order.created_at BETWEEN :from AND :to', { from, to })
      .andWhere('details.deleted_at IS NULL');

    const allowedUserIds = await this.getUserIdsByRole(params.user);
    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) qb.andWhere('1 = 0');
      else
        qb.andWhere('sale_by.id IN (:...userIds)', { userIds: allowedUserIds });
    }

    const empIds = this.parseCsvNumbers(params.employees);
    if (empIds.length > 0)
      qb.andWhere('sale_by.id IN (:...empIds)', { empIds });

    if (this.isAdmin(params.user)) {
      const deptIds = this.parseCsvNumbers(params.departments);
      if (deptIds.length > 0) {
        qb.andWhere(
          `sale_by_departments.id IN (:...deptIds)
           AND sale_by_departments.server_ip IS NOT NULL
           AND TRIM(sale_by_departments.server_ip) <> ''`,
          { deptIds },
        );
      }
    }

    const rows = await qb.getMany();

    // Blacklist filtering (mirror findAllPaginated approach)
    let filtered = rows as any[];
    const roleNames = (params.user?.roles || []).map((r: any) =>
      typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
    );
    const isAdmin = roleNames.includes('admin');
    if (!isAdmin) {
      const allowedIds = await this.getUserIdsByRole(params.user);
      const isManager = roleNames.some((r: string) => r.startsWith('manager-'));
      if (isManager) {
        const map =
          await this.orderBlacklistService.getBlacklistedContactsForUsers(
            allowedIds || [params.user.id],
          );
        const bl = new Set<string>();
        for (const set of map.values()) for (const id of set) bl.add(id);
        filtered = filtered.filter((od) => {
          const cid = this.extractCustomerIdFromMetadata(od.metadata);
          return !cid || !bl.has(cid);
        });
      } else {
        const list =
          await this.orderBlacklistService.getBlacklistedContactsForUser(
            params.user.id,
          );
        const bl = new Set(list);
        filtered = filtered.filter((od) => {
          const cid = this.extractCustomerIdFromMetadata(od.metadata);
          return !cid || !bl.has(cid);
        });
      }
    }

    // Aggregate
    const orderIds = new Set<number>();
    let orderDetails = 0;
    let quantity = 0;
    let revenue = 0;
    const byStatusMap = new Map<
      string,
      { count: number; quantity: number; revenue: number }
    >();

    for (const od of filtered) {
      if (od.order?.id) orderIds.add(od.order.id);
      orderDetails += 1;
      quantity += od.quantity || 0;
      revenue += (od.quantity || 0) * (od.unit_price || 0);
      const key = String(od.status || 'unknown');
      const cur = byStatusMap.get(key) || { count: 0, quantity: 0, revenue: 0 };
      cur.count += 1;
      cur.quantity += od.quantity || 0;
      cur.revenue += (od.quantity || 0) * (od.unit_price || 0);
      byStatusMap.set(key, cur);
    }

    // Simple timeline by day/week/month/quarter start key
    const bucketKey = (d: Date) => {
      if (normalizedPeriod === 'week') {
        const s = this.startOfWeekMonday(d);

        return `${s.getFullYear()}-W${Math.floor((s.getTime() - new Date(s.getFullYear(), 0, 1).getTime()) / (7 * 24 * 3600 * 1000)) + 1}`;
      }
      if (normalizedPeriod === 'month') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
      if (normalizedPeriod === 'quarter') {
        const q = Math.floor(d.getMonth() / 3) + 1;
        return `Q${q}-${d.getFullYear()}`;
      }
      // day
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const timelineMap = new Map<
      string,
      {
        orders: Set<number>;
        orderDetails: number;
        quantity: number;
        revenue: number;
      }
    >();
    for (const od of filtered) {
      const d = new Date(od.order?.created_at || od.created_at || from);
      const key = bucketKey(d);
      const cur = timelineMap.get(key) || {
        orders: new Set<number>(),
        orderDetails: 0,
        quantity: 0,
        revenue: 0,
      };
      if (od.order?.id) cur.orders.add(od.order.id);
      cur.orderDetails += 1;
      cur.quantity += od.quantity || 0;
      cur.revenue += (od.quantity || 0) * (od.unit_price || 0);
      timelineMap.set(key, cur);
    }

    const byStatus = Array.from(byStatusMap.entries()).map(([status, v]) => ({
      status,
      ...v,
    }));
    const timeline = Array.from(timelineMap.entries()).map(([k, v]) => ({
      bucket: k,
      from: from.toISOString(),
      to: to.toISOString(),
      orders: v.orders.size,
      orderDetails: v.orderDetails,
      quantity: v.quantity,
      revenue: v.revenue,
    }));

    return {
      period: {
        period: normalizedPeriod,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      totals: { orders: orderIds.size, orderDetails, quantity, revenue },
      byStatus,
      timeline,
    };
  }

  async getStatusStats(
    params: StatsParamsCommon,
  ): Promise<StatusStatsResponse> {
    const { from, to } = this.getDateRange(
      params.period,
      params.date,
      params.dateFrom,
      params.dateTo,
    );
    const qb = this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoinAndSelect('details.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .leftJoinAndSelect('sale_by.departments', 'sale_by_departments')
      .where('order.created_at BETWEEN :from AND :to', { from, to })
      .andWhere('details.deleted_at IS NULL');

    const allowedUserIds = await this.getUserIdsByRole(params.user);
    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) qb.andWhere('1 = 0');
      else
        qb.andWhere('sale_by.id IN (:...userIds)', { userIds: allowedUserIds });
    }

    const empIds = this.parseCsvNumbers(params.employees);
    if (empIds.length > 0)
      qb.andWhere('sale_by.id IN (:...empIds)', { empIds });

    if (this.isAdmin(params.user)) {
      const deptIds = this.parseCsvNumbers(params.departments);
      if (deptIds.length > 0) {
        qb.andWhere(
          `sale_by_departments.id IN (:...deptIds)
           AND sale_by_departments.server_ip IS NOT NULL
           AND TRIM(sale_by_departments.server_ip) <> ''`,
          { deptIds },
        );
      }
    }

    const statusFilter = this.parseCsvStrings(params.status);
    if (statusFilter.length > 0)
      qb.andWhere('details.status IN (:...sts)', { sts: statusFilter });

    let rows = await qb.getMany();

    // Blacklist filtering similar to overview
    const roleNames2 = (params.user?.roles || []).map((r: any) =>
      typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
    );
    const isAdmin2 = roleNames2.includes('admin');
    if (!isAdmin2) {
      const allowedIds = await this.getUserIdsByRole(params.user);
      const isManager = roleNames2.some((r: string) =>
        r.startsWith('manager-'),
      );
      if (isManager) {
        const map =
          await this.orderBlacklistService.getBlacklistedContactsForUsers(
            allowedIds || [params.user.id],
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

    const map = new Map<
      string,
      { count: number; quantity: number; revenue: number }
    >();
    for (const od of rows) {
      const key = String(od.status || 'unknown');
      const cur = map.get(key) || { count: 0, quantity: 0, revenue: 0 };
      cur.count += 1;
      cur.quantity += od.quantity || 0;
      cur.revenue += (od.quantity || 0) * (od.unit_price || 0);
      map.set(key, cur);
    }
    const items = Array.from(map.entries()).map(([status, v]) => ({
      status,
      ...v,
    }));
    return {
      period: {
        period: params.period,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      items,
    };
  }

  async getEmployeeStats(
    params: StatsParamsCommon,
  ): Promise<EmployeeStatsResponse> {
    const { from, to } = this.getDateRange(
      params.period,
      params.date,
      params.dateFrom,
      params.dateTo,
    );
    const qb = this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoinAndSelect('details.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .leftJoinAndSelect('sale_by.departments', 'sale_by_departments')
      .where('order.created_at BETWEEN :from AND :to', { from, to })
      .andWhere('details.deleted_at IS NULL');

    const allowedUserIds = await this.getUserIdsByRole(params.user);
    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) qb.andWhere('1 = 0');
      else
        qb.andWhere('sale_by.id IN (:...userIds)', { userIds: allowedUserIds });
    }

    if (this.isAdmin(params.user)) {
      const deptIds = this.parseCsvNumbers(params.departments);
      if (deptIds.length > 0) {
        qb.andWhere(
          `sale_by_departments.id IN (:...deptIds)
           AND sale_by_departments.server_ip IS NOT NULL
           AND TRIM(sale_by_departments.server_ip) <> ''`,
          { deptIds },
        );
      }
    }

    const rows = await qb.getMany();

    // Blacklist filtering for non-admins
    let filtered = rows as any[];
    const roleNames3 = (params.user?.roles || []).map((r: any) =>
      typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
    );
    const isAdmin3 = roleNames3.includes('admin');
    if (!isAdmin3) {
      const allowedIds = await this.getUserIdsByRole(params.user);
      const isManager = roleNames3.some((r: string) =>
        r.startsWith('manager-'),
      );
      if (isManager) {
        const map =
          await this.orderBlacklistService.getBlacklistedContactsForUsers(
            allowedIds || [params.user.id],
          );
        const bl = new Set<string>();
        for (const set of map.values()) for (const id of set) bl.add(id);
        filtered = filtered.filter((od) => {
          const cid = this.extractCustomerIdFromMetadata(od.metadata);
          return !cid || !bl.has(cid);
        });
      } else {
        const list =
          await this.orderBlacklistService.getBlacklistedContactsForUser(
            params.user.id,
          );
        const bl = new Set(list);
        filtered = filtered.filter((od) => {
          const cid = this.extractCustomerIdFromMetadata(od.metadata);
          return !cid || !bl.has(cid);
        });
      }
    }

    const map2 = new Map<
      number,
      {
        fullName: string;
        count: number;
        orders: Set<number>;
        quantity: number;
        revenue: number;
        byStatus: Map<string, number>;
      }
    >();
    for (const od of filtered) {
      const uid = od.order?.sale_by?.id;
      if (!uid) continue;
      const name =
        od.order?.sale_by?.fullName ||
        od.order?.sale_by?.username ||
        String(uid);
      const entry = map2.get(uid) || {
        fullName: name,
        count: 0,
        orders: new Set<number>(),
        quantity: 0,
        revenue: 0,
        byStatus: new Map<string, number>(),
      };
      entry.count += 1;
      if (od.order?.id) entry.orders.add(od.order.id);
      entry.quantity += od.quantity || 0;
      entry.revenue += (od.quantity || 0) * (od.unit_price || 0);
      const st = String(od.status || 'unknown');
      entry.byStatus.set(st, (entry.byStatus.get(st) || 0) + 1);
      map2.set(uid, entry);
    }
    const items = Array.from(map2.entries()).map(([userId, v]) => ({
      userId,
      fullName: v.fullName,
      count: v.count,
      orders: v.orders.size,
      quantity: v.quantity,
      revenue: v.revenue,
      byStatus: Array.from(v.byStatus.entries()).map(([status, count]) => ({
        status,
        count,
      })),
    }));
    return {
      period: {
        period: params.period,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      items,
    };
  }

  async getCustomerStats(
    params: StatsParamsCommon,
  ): Promise<CustomerStatsResponse> {
    const { from, to } = this.getDateRange(
      params.period,
      params.date,
      params.dateFrom,
      params.dateTo,
    );
    const qb = this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoinAndSelect('details.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .leftJoinAndSelect('sale_by.departments', 'sale_by_departments')
      .where('order.created_at BETWEEN :from AND :to', { from, to })
      .andWhere('details.deleted_at IS NULL');

    const allowedUserIds = await this.getUserIdsByRole(params.user);
    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) qb.andWhere('1 = 0');
      else
        qb.andWhere('sale_by.id IN (:...userIds)', { userIds: allowedUserIds });
    }

    const empIds = this.parseCsvNumbers(params.employees);
    if (empIds.length > 0)
      qb.andWhere('sale_by.id IN (:...empIds)', { empIds });

    if (this.isAdmin(params.user)) {
      const deptIds = this.parseCsvNumbers(params.departments);
      if (deptIds.length > 0) {
        qb.andWhere(
          `sale_by_departments.id IN (:...deptIds)
           AND sale_by_departments.server_ip IS NOT NULL
           AND TRIM(sale_by_departments.server_ip) <> ''`,
          { deptIds },
        );
      }
    }

    let rows = await qb.getMany();

    // Blacklist filtering for non-admins
    const roleNames4 = (params.user?.roles || []).map((r: any) =>
      typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
    );
    const isAdmin4 = roleNames4.includes('admin');
    if (!isAdmin4) {
      const allowedIds = await this.getUserIdsByRole(params.user);
      const isManager = roleNames4.some((r: string) =>
        r.startsWith('manager-'),
      );
      if (isManager) {
        const map =
          await this.orderBlacklistService.getBlacklistedContactsForUsers(
            allowedIds || [params.user.id],
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

    const map3 = new Map<
      string,
      {
        name: string | null;
        orders: Set<number>;
        count: number;
        quantity: number;
        revenue: number;
      }
    >();
    for (const od of rows) {
      const cid = this.extractCustomerIdFromMetadata(od.metadata) || null;
      const key = cid || `name:${od.customer_name || ''}`;
      const entry = map3.get(key) || {
        name: od.customer_name || null,
        orders: new Set<number>(),
        count: 0,
        quantity: 0,
        revenue: 0,
      };
      entry.count += 1;
      if (od.order?.id) entry.orders.add(od.order.id);
      entry.quantity += od.quantity || 0;
      entry.revenue += (od.quantity || 0) * (od.unit_price || 0);
      if (!entry.name && od.customer_name) entry.name = od.customer_name;
      map3.set(key, entry);
    }
    const items = Array.from(map3.entries()).map(([key, v]) => ({
      customerId: key.startsWith('name:') ? null : key,
      customerName: v.name,
      count: v.count,
      orders: v.orders.size,
      quantity: v.quantity,
      revenue: v.revenue,
    }));
    return {
      period: {
        period: params.period,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      items,
    };
  }

  // async getExpiredTodayStats(params: {
  //   employees?: string;
  //   departments?: string;
  //   user: any;
  // }) {
  //   const today = this.startOfDay(new Date());
  //   const qb = this.orderDetailRepository
  //     .createQueryBuilder('details')
  //     .leftJoinAndSelect('details.order', 'order')
  //     .leftJoinAndSelect('order.sale_by', 'sale_by')
  //     .leftJoinAndSelect('sale_by.departments', 'sale_by_departments')
  //     .andWhere('details.deleted_at IS NULL');

  //   const allowedUserIds = await this.getUserIdsByRole(params.user);
  //   if (allowedUserIds !== null) {
  //     if (allowedUserIds.length === 0) qb.andWhere('1 = 0');
  //     else
  //       qb.andWhere('sale_by.id IN (:...userIds)', { userIds: allowedUserIds });
  //   }

  //   const empIds = this.parseCsvNumbers(params.employees);
  //   if (empIds.length > 0)
  //     qb.andWhere('sale_by.id IN (:...empIds)', { empIds });

  //   if (this.isAdmin(params.user)) {
  //     const deptIds = this.parseCsvNumbers(params.departments);
  //     if (deptIds.length > 0) {
  //       qb.andWhere(
  //         `sale_by_departments.id IN (:...deptIds)
  //          AND sale_by_departments.server_ip IS NOT NULL
  //          AND TRIM(sale_by_departments.server_ip) <> ''`,
  //         { deptIds },
  //       );
  //     }
  //   }

  //   let rows = await qb.getMany();

  //   // Blacklist filter for non-admins
  //   const roleNames5 = (params.user?.roles || []).map((r: any) =>
  //     typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
  //   );
  //   const isAdmin5 = roleNames5.includes('admin');
  //   if (!isAdmin5) {
  //     const allowedIds = await this.getUserIdsByRole(params.user);
  //     const isManager = roleNames5.some((r: string) =>
  //       r.startsWith('manager-'),
  //     );
  //     if (isManager) {
  //       const map =
  //         await this.orderBlacklistService.getBlacklistedContactsForUsers(
  //           allowedIds || [params.user.id],
  //         );
  //       const bl = new Set<string>();
  //       for (const set of map.values()) for (const id of set) bl.add(id);
  //       rows = rows.filter((od) => {
  //         const cid = this.extractCustomerIdFromMetadata(od.metadata);
  //         return !cid || !bl.has(cid);
  //       });
  //     } else {
  //       const list =
  //         await this.orderBlacklistService.getBlacklistedContactsForUser(
  //           params.user.id,
  //         );
  //       const bl = new Set(list);
  //       rows = rows.filter((od) => {
  //         const cid = this.extractCustomerIdFromMetadata(od.metadata);
  //         return !cid || !bl.has(cid);
  //       });
  //     }
  //   }

  //   let expiredToday = 0;
  //   let overdue = 0;
  //   const byEmp = new Map<
  //     number,
  //     { fullName: string; expiredToday: number; overdue: number }
  //   >();
  //   for (const od of rows) {
  //     const dExt = this.calcDynamicExtended(od.created_at || null, od.extended);
  //     const uid = od.order?.sale_by?.id;
  //     const name =
  //       od.order?.sale_by?.fullName ||
  //       od.order?.sale_by?.username ||
  //       String(uid || 'N/A');
  //     if (dExt === 0) {
  //       expiredToday += 1;
  //       if (uid) {
  //         const e = byEmp.get(uid) || {
  //           fullName: name,
  //           expiredToday: 0,
  //           overdue: 0,
  //         };
  //         e.expiredToday += 1;
  //         byEmp.set(uid, e);
  //       }
  //     } else if (typeof dExt === 'number' && dExt < 0) {
  //       overdue += 1;
  //       if (uid) {
  //         const e = byEmp.get(uid) || {
  //           fullName: name,
  //           expiredToday: 0,
  //           overdue: 0,
  //         };
  //         e.overdue += 1;
  //         byEmp.set(uid, e);
  //       }
  //     }
  //   }

  //   return {
  //     date: this.startOfDay(today).toISOString().slice(0, 10),
  //     totals: { expiredToday, overdue },
  //     byEmployee: Array.from(byEmp.entries()).map(([userId, v]) => ({
  //       userId,
  //       fullName: v.fullName,
  //       expiredToday: v.expiredToday,
  //       overdue: v.overdue,
  //     })),
  //   };
  // }
  async getExpiredTodayStats(params: {
    employees?: string;
    departments?: string;
    user: any;
  }) {
    const today = this.startOfDay(new Date());
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    // ✅ Chỉ lấy đơn ẩn HÔM NAY và chưa bị xóa mềm
    const qb = this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoinAndSelect('details.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .leftJoinAndSelect('sale_by.departments', 'sale_by_departments')
      .where('details.deleted_at IS NULL') // Loại bỏ đơn xóa mềm
      .andWhere('details.hidden_at >= :todayStart', { todayStart: today })
      .andWhere('details.hidden_at < :tomorrowStart', {
        tomorrowStart: tomorrow,
      });

    // Permission scoping
    const allowedUserIds = await this.getUserIdsByRole(params.user);
    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) qb.andWhere('1 = 0');
      else
        qb.andWhere('sale_by.id IN (:...userIds)', { userIds: allowedUserIds });
    }

    // Employee filter
    const empIds = this.parseCsvNumbers(params.employees);
    if (empIds.length > 0)
      qb.andWhere('sale_by.id IN (:...empIds)', { empIds });

    // Department filter (chỉ admin)
    if (this.isAdmin(params.user)) {
      const deptIds = this.parseCsvNumbers(params.departments);
      if (deptIds.length > 0) {
        qb.andWhere(
          `sale_by_departments.id IN (:...deptIds)
         AND sale_by_departments.server_ip IS NOT NULL
         AND TRIM(sale_by_departments.server_ip) <> ''`,
          { deptIds },
        );
      }
    }

    let rows = await qb.getMany();
    const roleNames = (params.user?.roles || []).map((r: any) =>
      typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
    );
    const isAdmin = roleNames.includes('admin');

    if (!isAdmin) {
      const allowedIds = await this.getUserIdsByRole(params.user);
      const isManager = roleNames.some((r: string) => r.startsWith('manager-'));

      if (isManager) {
        const map =
          await this.orderBlacklistService.getBlacklistedContactsForUsers(
            allowedIds || [params.user.id],
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

    // ✅ Đơn giản hóa: Tất cả đơn trả về đều là "hết hạn hôm nay"
    let expiredToday = rows.length;
    let overdue = 0; // Không có overdue vì chỉ lấy đơn ẩn hôm nay

    const byEmp = new Map<
      number,
      { fullName: string; expiredToday: number; overdue: number }
    >();

    for (const od of rows) {
      const uid = od.order?.sale_by?.id;
      const name =
        od.order?.sale_by?.fullName ||
        od.order?.sale_by?.username ||
        String(uid || 'N/A');

      if (uid) {
        const e = byEmp.get(uid) || {
          fullName: name,
          expiredToday: 0,
          overdue: 0,
        };
        e.expiredToday += 1; // Tất cả đều là hết hạn hôm nay
        byEmp.set(uid, e);
      }
    }
    return {
      date: this.startOfDay(today).toISOString().slice(0, 10),
      totals: { expiredToday, overdue },
      byEmployee: Array.from(byEmp.entries()).map(([userId, v]) => ({
        userId,
        fullName: v.fullName,
        expiredToday: v.expiredToday,
        overdue: v.overdue,
      })),
    };
  }
}

function roleNamesIncludes(user: any, roleName: string): boolean {
  const roleNames = (user?.roles || []).map((r: any) =>
    typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
  );
  return roleNames.includes(roleName.toLowerCase());
}
function roleNamesSome(user: any, predicate: (r: string) => boolean): boolean {
  const roleNames = (user?.roles || []).map((r: any) =>
    typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
  );
  return roleNames.some(predicate);
}

// =============== Stats contracts ===============
export interface OverviewStatsResponse {
  period: { period: string; from: string; to: string };
  totals: {
    orders: number;
    orderDetails: number;
    quantity: number;
    revenue: number;
  };
  byStatus: Array<{
    status: string;
    count: number;
    quantity: number;
    revenue: number;
  }>;
  timeline: Array<{
    bucket: string;
    from: string;
    to: string;
    orders: number;
    orderDetails: number;
    quantity: number;
    revenue: number;
  }>;
}

export interface StatusStatsResponse {
  period: { period: string; from: string; to: string };
  items: Array<{
    status: string;
    count: number;
    quantity: number;
    revenue: number;
  }>;
}

export interface EmployeeStatsResponse {
  period: { period: string; from: string; to: string };
  items: Array<{
    userId: number;
    fullName: string;
    count: number;
    orders: number;
    quantity: number;
    revenue: number;
    byStatus?: Array<{ status: string; count: number }>;
  }>;
}

export interface CustomerStatsResponse {
  period: { period: string; from: string; to: string };
  items: Array<{
    customerId: string | null;
    customerName: string | null;
    count: number;
    orders: number;
    quantity: number;
    revenue: number;
  }>;
}

// =============== Stats implementations ===============
export interface StatsParamsCommon {
  period: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  employees?: string;
  departments?: string;
  status?: string; // csv
  user: any;
}
