import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, Between, Not, IsNull } from 'typeorm';
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
  date?: string;
  dateRange?: { start: string; end: string };
  employee?: string;
  employees?: string;
  departments?: string;
  products?: string;
  warningLevel?: string;
  sortField?: 'quantity' | 'unit_price' | 'extended' | 'dynamicExtended' | null;
  sortDirection?: 'asc' | 'desc' | null;
  user?: any; // truyền cả user object
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
        users: (dept.users || []).map((u) => ({
          value: u.id,
          label: u.fullName || u.username,
        })),
      }));
    } else {
      const managerRoles = roleNames.filter((r: string) =>
        r.startsWith('manager-'),
      );

      if (managerRoles.length > 0) {
        // Manager: chỉ lấy department của mình và users trong đó, chỉ lấy department có server_ip hợp lệ
        const departmentSlugs = managerRoles.map((r: string) =>
          r.replace('manager-', ''),
        );

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
          users: (dept.users || []).map((u) => ({
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
            users: [
              {
                value: currentUser.id,
                label: currentUser.fullName || currentUser.username,
              },
            ],
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
      date,
      dateRange,
      employee,
      employees,
      departments,
      products,
      warningLevel,
      sortField,
      sortDirection,
      user,
    } = filters;
    const skip = (page - 1) * pageSize;

    const queryBuilder = this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoinAndSelect('details.order', 'order')
      .leftJoinAndSelect('details.product', 'product')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .leftJoinAndSelect('sale_by.departments', 'sale_by_departments');

    // Phân quyền xem
    const allowedUserIds = await this.getUserIdsByRole(user);
    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) {
        queryBuilder.andWhere('1 = 0');
      } else {
        queryBuilder.andWhere('sale_by.id IN (:...userIds)', {
          userIds: allowedUserIds,
        });
      }
    }

    // Apply filters as before
    if (search) {
      queryBuilder.andWhere(
        '(CAST(details.id AS CHAR) LIKE :search OR details.customer_name LIKE :search OR details.raw_item LIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (status) {
      queryBuilder.andWhere('details.status = :status', { status });
    }

    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      queryBuilder.andWhere(
        'order.created_at BETWEEN :startDate AND :endDate',
        { startDate, endDate },
      );
    }

    if (dateRange && dateRange.start && dateRange.end) {
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      endDate.setHours(23, 59, 59, 999);
      queryBuilder.andWhere(
        'order.created_at BETWEEN :rangeStart AND :rangeEnd',
        { rangeStart: startDate, rangeEnd: endDate },
      );
    }

    if (employee) {
      queryBuilder.andWhere('sale_by.id = :employee', { employee });
    }

    if (employees) {
      const employeeIds = employees
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !isNaN(id));
      if (employeeIds.length > 0) {
        queryBuilder.andWhere('sale_by.id IN (:...employeeIds)', {
          employeeIds,
        });
      }
    }

    if (departments) {
      const departmentIds = departments
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !isNaN(id));
      if (departmentIds.length > 0) {
        queryBuilder.andWhere(
          `
        sale_by_departments.id IN (:...departmentIds)
        AND sale_by_departments.server_ip IS NOT NULL
        AND TRIM(sale_by_departments.server_ip) <> ''
      `,
          { departmentIds },
        );
      }
    }

    if (products) {
      const productIds = products
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !isNaN(id));
      if (productIds.length > 0) {
        queryBuilder.andWhere('details.product_id IN (:...productIds)', {
          productIds,
        });
      }
    }

    if (warningLevel) {
      const levels = warningLevel
        .split(',')
        .map((level) => parseInt(level.trim(), 10))
        .filter((level) => !isNaN(level));
      if (levels.length > 0) {
        queryBuilder.andWhere('details.extended IN (:...levels)', { levels });
      }
    }

    // Chuẩn bị data blacklist theo role
    let managerBlacklistMap: Map<number, Set<string>> | undefined;
    let userBlacklisted: string[] | undefined;

    if (user && user.roles) {
      const roleNames = (user.roles || []).map((r: any) =>
        typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
      );
      const isAdmin = roleNames.includes('admin');
      const isManager = roleNames.some((r: string) => r.startsWith('manager-'));

      if (!isAdmin) {
        if (isManager) {
          // Manager: không được thấy các đơn của khách bị blacklist bởi bất kỳ user nào trong phạm vi họ có thể xem (allowedUserIds)
          managerBlacklistMap =
            await this.orderBlacklistService.getBlacklistedContactsForUsers(
              allowedUserIds || [],
            );
        } else {
          // User: ẩn các đơn của khách nằm trong blacklist của chính họ
          userBlacklisted =
            await this.orderBlacklistService.getBlacklistedContactsForUser(
              user.id,
            );
        }
      }
    }

    // LUÔN lấy tất cả data để áp dụng unified sorting
    const allData = await queryBuilder.getMany();

    // Tính calcDynamicExtended cho tất cả data
    const dataWithDynamicExtended = allData.map((orderDetail) => ({
      ...orderDetail,
      dynamicExtended: this.calcDynamicExtended(
        orderDetail.created_at || null,
        orderDetail.extended,
      ),
    }));

    // LUÔN sort theo calcDynamicExtended
    const actualSortDirection =
      sortDirection?.toLowerCase() === 'asc' ? 'asc' : 'desc';
    dataWithDynamicExtended.sort((a, b) => {
      const aExtended =
        a.dynamicExtended !== null ? a.dynamicExtended : -999999;
      const bExtended =
        b.dynamicExtended !== null ? b.dynamicExtended : -999999;

      // Tiêu chí 1: So sánh extended
      const extendedDiff =
        actualSortDirection === 'asc'
          ? aExtended - bExtended
          : bExtended - aExtended;

      // Tiêu chí 2: Nếu extended bằng nhau, so sánh created_at giảm dần
      if (extendedDiff === 0) {
        const aTime = new Date(a.created_at || 0).getTime();
        const bTime = new Date(b.created_at || 0).getTime();
        return bTime - aTime; // Giảm dần: mới hơn trước
      }

      return extendedDiff;
    });

    // Áp dụng blacklist filter theo role
    let filteredData = dataWithDynamicExtended;

    if (user && !roleNamesIncludes(user, 'admin')) {
      if (roleNamesSome(user, (r) => r.startsWith('manager-'))) {
        if (managerBlacklistMap && (allowedUserIds?.length || 0) > 0) {
          const blacklistedSet = new Set<string>();
          for (const uid of allowedUserIds!) {
            const set = managerBlacklistMap.get(uid);
            if (set) for (const cid of set) blacklistedSet.add(cid);
          }
          const filterFn = (od: OrderDetail) => {
            const cid = this.extractCustomerIdFromMetadata(od.metadata);
            return !cid || !blacklistedSet.has(cid);
          };
          filteredData = filteredData.filter(filterFn);
        }
      } else {
        if (userBlacklisted && userBlacklisted.length > 0) {
          const set = new Set(userBlacklisted);
          const filterFn = (od: OrderDetail) => {
            const cid = this.extractCustomerIdFromMetadata(od.metadata);
            return !cid || !set.has(cid);
          };
          filteredData = filteredData.filter(filterFn);
        }
      }
    }

    // Áp dụng pagination sau khi sort và filter
    const data = filteredData.slice(skip, skip + pageSize);
    const actualTotal = filteredData.length;

    return { data, total: actualTotal, page, pageSize };
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
