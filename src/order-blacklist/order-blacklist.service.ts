import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderBlacklist } from './order-blacklist.entity';
import {
  CreateOrderBlacklistDto,
  UpdateOrderBlacklistDto,
  FindOrderBlacklistDto,
} from './dto/order-blacklist.dto';
import { OrderDetail } from '../order-details/order-detail.entity';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';

@Injectable()
export class OrderBlacklistService {
  private readonly logger = new Logger(OrderBlacklistService.name);
  
  // ✅ Thêm cache để tối ưu hiệu suất
  private customerNameCache = new Map<string, string>();
  private cacheExpiry = new Map<string, number>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 phút

  constructor(
    @InjectRepository(OrderBlacklist)
    private readonly orderBlacklistRepository: Repository<OrderBlacklist>,
    @InjectRepository(OrderDetail)
    private readonly orderDetailRepository: Repository<OrderDetail>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Department)
    private readonly departmentRepository: Repository<Department>,
  ) {}

  // ✅ Thêm method để quản lý cache
  private getCachedCustomerName(zaloContactId: string): string | null {
    const expiry = this.cacheExpiry.get(zaloContactId);
    if (expiry && Date.now() < expiry) {
      return this.customerNameCache.get(zaloContactId) || null;
    }
    // Xóa cache hết hạn
    this.customerNameCache.delete(zaloContactId);
    this.cacheExpiry.delete(zaloContactId);
    return null;
  }

  private setCachedCustomerName(zaloContactId: string, customerName: string): void {
    this.customerNameCache.set(zaloContactId, customerName);
    this.cacheExpiry.set(zaloContactId, Date.now() + this.CACHE_TTL);
  }

  async create(createDto: CreateOrderBlacklistDto): Promise<OrderBlacklist> {
    try {
      // Kiểm tra xem đã tồn tại blacklist cho user và zalo contact này chưa
      const existing = await this.orderBlacklistRepository.findOne({
        where: {
          userId: createDto.userId,
          zaloContactId: createDto.zaloContactId,
        },
      });

      if (existing) {
        throw new ConflictException(
          `Blacklist entry already exists for user ${createDto.userId} and contact ${createDto.zaloContactId}`,
        );
      }

      const blacklist = this.orderBlacklistRepository.create(createDto);
      const saved = await this.orderBlacklistRepository.save(blacklist);

      this.logger.log(
        `Created blacklist entry: user ${createDto.userId}, contact ${createDto.zaloContactId}`,
      );
      return saved;
    } catch (error) {
      this.logger.error('Error creating order blacklist entry:', error);
      throw error;
    }
  }

  async findAll(
    findDto: FindOrderBlacklistDto,
  ): Promise<{ data: OrderBlacklist[]; total: number }> {
    try {
      const { userId, zaloContactId, page = 1, limit = 10 } = findDto;
      const queryBuilder =
        this.orderBlacklistRepository.createQueryBuilder('blacklist');

      if (userId) {
        queryBuilder.andWhere('blacklist.userId = :userId', { userId });
      }

      if (zaloContactId) {
        queryBuilder.andWhere('blacklist.zaloContactId = :zaloContactId', {
          zaloContactId,
        });
      }

      queryBuilder
        .orderBy('blacklist.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [data, total] = await queryBuilder.getManyAndCount();

      return { data, total };
    } catch (error) {
      this.logger.error('Error finding order blacklist entries:', error);
      throw error;
    }
  }

  async findOne(id: number): Promise<OrderBlacklist> {
    try {
      const blacklist = await this.orderBlacklistRepository.findOne({
        where: { id },
      });

      if (!blacklist) {
        throw new NotFoundException(
          `Order blacklist entry with ID ${id} not found`,
        );
      }

      return blacklist;
    } catch (error) {
      this.logger.error(
        `Error finding order blacklist entry with ID ${id}:`,
        error,
      );
      throw error;
    }
  }

  async update(
    id: number,
    updateDto: UpdateOrderBlacklistDto,
  ): Promise<OrderBlacklist> {
    try {
      const blacklist = await this.findOne(id);

      Object.assign(blacklist, updateDto);
      const updated = await this.orderBlacklistRepository.save(blacklist);

      this.logger.log(`Updated blacklist entry ID ${id}`);
      return updated;
    } catch (error) {
      this.logger.error(
        `Error updating order blacklist entry with ID ${id}:`,
        error,
      );
      throw error;
    }
  }

  async remove(id: number): Promise<void> {
    try {
      const blacklist = await this.findOne(id);
      await this.orderBlacklistRepository.remove(blacklist);

      this.logger.log(`Removed blacklist entry ID ${id}`);
    } catch (error) {
      this.logger.error(
        `Error removing order blacklist entry with ID ${id}:`,
        error,
      );
      throw error;
    }
  }

  async findByUserId(userId: number): Promise<OrderBlacklist[]> {
    try {
      return await this.orderBlacklistRepository.find({
        where: { userId },
        order: { created_at: 'DESC' },
      });
    } catch (error) {
      this.logger.error(
        `Error finding blacklist entries for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  async findByZaloContactId(zaloContactId: string): Promise<OrderBlacklist[]> {
    try {
      return await this.orderBlacklistRepository.find({
        where: { zaloContactId },
        order: { created_at: 'DESC' },
      });
    } catch (error) {
      this.logger.error(
        `Error finding blacklist entries for contact ${zaloContactId}:`,
        error,
      );
      throw error;
    }
  }

  async isBlacklisted(userId: number, zaloContactId: string): Promise<boolean> {
    try {
      const count = await this.orderBlacklistRepository.count({
        where: {
          userId,
          zaloContactId,
        },
      });

      return count > 0;
    } catch (error) {
      this.logger.error(
        `Error checking blacklist status for user ${userId} and contact ${zaloContactId}:`,
        error,
      );
      throw error;
    }
  }

  async getBlacklistedContactsForUser(userId: number): Promise<string[]> {
    try {
      const blacklists = await this.orderBlacklistRepository.find({
        where: { userId },
        select: ['zaloContactId'],
      });

      return blacklists.map((bl) => bl.zaloContactId);
    } catch (error) {
      this.logger.error(
        `Error getting blacklisted contacts for user ${userId}:`,
        error,
      );
      throw error;
    }
  }

  // Helper function để extract customer_id từ metadata
  private extractCustomerIdFromMetadata(metadata: any): string | null {
    try {
      if (!metadata) return null;

      // Nếu metadata là string, parse thành JSON
      const metadataObj =
        typeof metadata === 'string' ? JSON.parse(metadata) : metadata;

      return metadataObj?.customer_id || null;
    } catch (error) {
      this.logger.error('Error extracting customer_id from metadata:', error);
      return null;
    }
  }

  // Lấy customer name từ order detail dựa vào zalo_contact_id
  private async getCustomerNameByZaloContactId(
    zaloContactId: string,
  ): Promise<string | null> {
    try {
      // ✅ Kiểm tra cache trước
      const cachedName = this.getCachedCustomerName(zaloContactId);
      if (cachedName !== null) {
        return cachedName;
      }

      // ✅ Tối ưu: Query trực tiếp với điều kiện JSON
      const orderDetail = await this.orderDetailRepository
        .createQueryBuilder('od')
        .where('od.metadata IS NOT NULL')
        .andWhere("JSON_EXTRACT(od.metadata, '$.customer_id') = :zaloContactId", {
          zaloContactId,
        })
        .select(['od.customer_name'])
        .getOne();

      const customerName = orderDetail?.customer_name || null;
      
      // ✅ Lưu vào cache nếu có kết quả
      if (customerName) {
        this.setCachedCustomerName(zaloContactId, customerName);
      }

      return customerName;
    } catch (error) {
      this.logger.error(
        `Error getting customer name for contact ${zaloContactId}:`,
        error,
      );
      return null;
    }
  }

  // Lấy danh sách blacklist với phân quyền và thông tin customer
  async findAllWithPermissions(
    currentUser: any,
    filters: {
      page?: number;
      pageSize?: number;
      search?: string;
      departments?: number[]; // ✅ Thêm filter department
      users?: number[]; // ✅ Thêm filter user
    } = {},
  ): Promise<{ data: any[]; total: number }> {
    try {
      const {
        page = 1,
        pageSize = 10,
        search = '',
        departments = [],
        users = [],
      } = filters;
      const limit = pageSize;
      const offset = (page - 1) * pageSize;

      // ✅ Sửa logic lấy roles
      const userRoles = currentUser.roles
        ? currentUser.roles.map((role) => role.name)
        : [];

      const isAdmin = userRoles.includes('admin');
      const isViewRole = userRoles.includes('view');
      const isManager = userRoles.some(
        (role) => role && role.includes('manager'),
      );

      // ✅ Tối ưu: Batch query customer names thay vì N+1 queries
      let matchingZaloContactIds: string[] = [];
      if (search && search.trim()) {
        const orderDetails = await this.orderDetailRepository
          .createQueryBuilder('od')
          .where('LOWER(od.customer_name) LIKE LOWER(:search)', {
            search: `%${search.trim()}%`,
          })
          .andWhere('od.metadata IS NOT NULL')
          .select(['od.metadata'])
          .limit(1000) // ✅ Giới hạn kết quả để tránh quá tải
          .getMany();

        matchingZaloContactIds = orderDetails
          .map((od) => this.extractCustomerIdFromMetadata(od.metadata))
          .filter((id) => id !== null);
      }

      // Tạo main query
      let queryBuilder = this.orderBlacklistRepository
        .createQueryBuilder('blacklist')
        .leftJoinAndSelect('blacklist.user', 'user')
        .leftJoinAndSelect('user.departments', 'departments');

      // ✅ Apply phân quyền với logic đúng
      if (isViewRole || isAdmin) {
        // Role view và admin: có thể xem tất cả blacklist
        // Không cần thêm filter nào
      } else if (!isAdmin && !isManager) {
        // User thường: chỉ thấy blacklist của mình
        queryBuilder.andWhere('blacklist.userId = :userId', {
          userId: currentUser.id,
        });
      } else if (isManager && !isAdmin) {
        // Manager: chỉ thấy user trong phòng ban có server_ip
        const managerDepartments = await this.departmentRepository
          .createQueryBuilder('dept')
          .innerJoin('dept.users', 'user')
          .where('user.id = :managerId', { managerId: currentUser.id })
          .andWhere('dept.server_ip IS NOT NULL')
          .andWhere('dept.server_ip != :empty', { empty: '' })
          .getMany();

        if (managerDepartments.length > 0) {
          const departmentIds = managerDepartments.map((d) => d.id);
          queryBuilder.andWhere((qb) => {
            const subQuery = qb
              .subQuery()
              .select('u.id')
              .from(User, 'u')
              .innerJoin('u.departments', 'd')
              .where('d.id IN (:...departmentIds)', { departmentIds })
              .getQuery();
            return `blacklist.userId IN ${subQuery}`;
          });
        } else {
          // Manager không có department với server_ip thì không thấy gì
          queryBuilder.andWhere('1 = 0');
        }
      }
      // Admin thì không có filter bổ sung

      // ✅ Apply department filter
      if (departments.length > 0) {
        queryBuilder.andWhere((qb) => {
          const subQuery = qb
            .subQuery()
            .select('u.id')
            .from(User, 'u')
            .innerJoin('u.departments', 'd')
            .where('d.id IN (:...departmentIds)', {
              departmentIds: departments,
            })
            .getQuery();
          return `blacklist.userId IN ${subQuery}`;
        });
      }

      // ✅ Apply user filter
      if (users.length > 0) {
        queryBuilder.andWhere('blacklist.userId IN (:...userIds)', {
          userIds: users,
        });
      }

      // Apply search
      if (search && search.trim()) {
        const searchConditions = [
          'LOWER(blacklist.reason) LIKE LOWER(:search)',
          'LOWER(user.fullName) LIKE LOWER(:search)',
          'LOWER(user.username) LIKE LOWER(:search)',
        ];

        if (matchingZaloContactIds.length > 0) {
          searchConditions.push(
            'blacklist.zaloContactId IN (:...zaloContactIds)',
          );
          queryBuilder.setParameter('zaloContactIds', matchingZaloContactIds);
        }

        queryBuilder.andWhere(`(${searchConditions.join(' OR ')})`, {
          search: `%${search.trim()}%`,
        });
      }

      // Đếm total
      const total = await queryBuilder.getCount();

      // Lấy dữ liệu với pagination
      const blacklists = await queryBuilder
        .orderBy('blacklist.created_at', 'DESC')
        .skip(offset)
        .take(limit)
        .getMany();

      // ✅ Tối ưu: Batch query customer names thay vì N+1 queries
      const enrichedData = await this.enrichBlacklistWithCustomerNames(blacklists);

      return {
        data: enrichedData,
        total,
      };
    } catch (error) {
      this.logger.error(
        'Error finding blacklist entries with permissions:',
        error,
      );
      throw error;
    }
  }

  // ✅ Thêm method mới để batch query customer names
  private async enrichBlacklistWithCustomerNames(
    blacklists: OrderBlacklist[],
  ): Promise<any[]> {
    if (blacklists.length === 0) return [];

    try {
      // Lấy tất cả unique zaloContactIds
      const zaloContactIds = [...new Set(blacklists.map(bl => bl.zaloContactId))];
      
      // Batch query customer names
      const customerNamesMap = new Map<string, string>();
      
      if (zaloContactIds.length > 0) {
        // ✅ TODO: Cần tạo migration để thêm index cho JSON_EXTRACT trên order_details.metadata
        // CREATE INDEX idx_order_details_metadata_customer_id ON order_details ((JSON_EXTRACT(metadata, '$.customer_id')));
        const orderDetails = await this.orderDetailRepository
          .createQueryBuilder('od')
          .where('od.metadata IS NOT NULL')
          .andWhere("JSON_EXTRACT(od.metadata, '$.customer_id') IN (:...zaloContactIds)", {
            zaloContactIds,
          })
          .select(['od.metadata', 'od.customer_name'])
          .getMany();

        // Tạo map từ zaloContactId -> customer_name
        for (const od of orderDetails) {
          const customerId = this.extractCustomerIdFromMetadata(od.metadata);
          if (customerId && od.customer_name) {
            customerNamesMap.set(customerId, od.customer_name);
          }
        }
      }

      // Enrich blacklist data
      return blacklists.map(blacklist => ({
        ...blacklist,
        customerName: customerNamesMap.get(blacklist.zaloContactId) || 'N/A',
      }));
    } catch (error) {
      this.logger.error('Error enriching blacklist with customer names:', error);
      // Fallback: trả về data gốc nếu có lỗi
      return blacklists.map(blacklist => ({
        ...blacklist,
        customerName: 'N/A',
      }));
    }
  }

  // ✅ Thêm method để lấy departments cho filter
  async getDepartmentsForFilter(
    currentUser: any,
    userIds?: number[],
  ): Promise<Array<{ value: number; label: string }>> {
    const userRoles = currentUser.roles
      ? currentUser.roles.map((role) => role.name)
      : [];
    const isAdmin = userRoles.includes('admin');
    const isViewRole = userRoles.includes('view');
    const isManager = userRoles.some(
      (role) => role && role.includes('manager'),
    );

    if (isAdmin || isViewRole) {
      // Admin / view: nếu có userIds thì chỉ lấy departments mà các user đó thuộc về
      if (userIds && userIds.length > 0) {
        const departments = await this.departmentRepository
          .createQueryBuilder('dept')
          .innerJoin('dept.users', 'user')
          .where('user.id IN (:...userIds)', { userIds })
          .select(['dept.id', 'dept.name'])
          .groupBy('dept.id')
          .orderBy('dept.name', 'ASC')
          .getMany();
        return departments.map((dept) => ({ value: dept.id, label: dept.name }));
      } else {
        const departments = await this.departmentRepository.find({
          select: ['id', 'name'],
            order: { name: 'ASC' },
        });
        return departments.map((dept) => ({ value: dept.id, label: dept.name }));
      }
    } else if (isManager) {
      // Manager: chỉ lấy departments có server_ip mà họ thuộc về
      const departments = await this.departmentRepository
        .createQueryBuilder('dept')
        .innerJoin('dept.users', 'user')
        .where('user.id = :managerId', { managerId: currentUser.id })
        .andWhere('dept.server_ip IS NOT NULL')
        .andWhere('dept.server_ip != :empty', { empty: '' })
        .select(['dept.id', 'dept.name'])
        .orderBy('dept.name', 'ASC')
        .getMany();
      // Nếu truyền userIds, giao với departments mà manager được phép
      if (userIds && userIds.length > 0) {
        const allowedDeptIds = new Set(departments.map((d) => d.id));
        const filtered = await this.departmentRepository
          .createQueryBuilder('dept')
          .innerJoin('dept.users', 'user')
          .where('user.id IN (:...userIds)', { userIds })
          .andWhere('dept.id IN (:...allowedIds)', {
            allowedIds: Array.from(allowedDeptIds),
          })
          .select(['dept.id', 'dept.name'])
          .groupBy('dept.id')
          .orderBy('dept.name', 'ASC')
          .getMany();
        return filtered.map((dept) => ({ value: dept.id, label: dept.name }));
      }
      return departments.map((dept) => ({ value: dept.id, label: dept.name }));
    }

    // User thường: không có quyền filter theo department
    return [];
  }

  // ✅ Thêm method để lấy users cho filter
  async getUsersForFilter(
    currentUser: any,
    departmentIds?: number[],
  ): Promise<Array<{ value: number; label: string }>> {
    const userRoles = currentUser.roles
      ? currentUser.roles.map((role) => role.name)
      : [];
    const isAdmin = userRoles.includes('admin');
    const isViewRole = userRoles.includes('view');
    const isManager = userRoles.some(
      (role) => role && role.includes('manager'),
    );

    let queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .leftJoin('user.departments', 'department')
      .select(['user.id', 'user.fullName', 'user.employeeCode'])
      .where('user.deletedAt IS NULL')
      .orderBy('user.fullName', 'ASC');

    if (isAdmin || isViewRole) {
      // Admin và role view: lấy tất cả users, có thể filter theo departments
      if (departmentIds && departmentIds.length > 0) {
        queryBuilder.andWhere('department.id IN (:...departmentIds)', {
          departmentIds,
        });
      }
    } else if (isManager) {
      // Manager: chỉ lấy users trong phòng ban có server_ip của họ
      const managerDepartments = await this.departmentRepository
        .createQueryBuilder('dept')
        .innerJoin('dept.users', 'user')
        .where('user.id = :managerId', { managerId: currentUser.id })
        .andWhere('dept.server_ip IS NOT NULL')
        .andWhere('dept.server_ip != :empty', { empty: '' })
        .getMany();

      if (managerDepartments.length > 0) {
        const allowedDepartmentIds = managerDepartments.map((d) => d.id);

        // Nếu có filter departments thì giao với departments được phép
        if (departmentIds && departmentIds.length > 0) {
          const filteredDepartmentIds = departmentIds.filter((id) =>
            allowedDepartmentIds.includes(id),
          );
          if (filteredDepartmentIds.length > 0) {
            queryBuilder.andWhere('department.id IN (:...departmentIds)', {
              departmentIds: filteredDepartmentIds,
            });
          } else {
            return []; // Không có department nào được phép
          }
        } else {
          queryBuilder.andWhere('department.id IN (:...departmentIds)', {
            departmentIds: allowedDepartmentIds,
          });
        }
      } else {
        return []; // Manager không có department với server_ip
      }
    } else {
      // User thường: không có quyền filter theo user khác
      return [];
    }

    const users = await queryBuilder.getMany();
    return users.map((user) => ({
      value: user.id,
      label: `${user.fullName}${user.employeeCode ? ` (${user.employeeCode})` : ''}`,
    }));
  }

  // ✅ New: Get blacklisted contacts for multiple users at once
  async getBlacklistedContactsForUsers(
    userIds: number[],
  ): Promise<Map<number, Set<string>>> {
    try {
      if (!userIds || userIds.length === 0) return new Map();

      const rows = await this.orderBlacklistRepository
        .createQueryBuilder('blacklist')
        .select(['blacklist.userId AS userId', 'blacklist.zaloContactId AS zaloContactId'])
        .where('blacklist.userId IN (:...userIds)', { userIds })
        .getRawMany<{ userId: number; zaloContactId: string }>();

      const map = new Map<number, Set<string>>();
      for (const row of rows) {
        const uid = Number(row.userId);
        const cid = row.zaloContactId;
        if (!map.has(uid)) map.set(uid, new Set());
        map.get(uid)!.add(cid);
      }
      return map;
    } catch (error) {
      this.logger.error('Error getting blacklisted contacts for users:', error);
      throw error;
    }
  }
}
