import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalysisBlock } from './analysis-block.entity';
import {
  CreateAnalysisBlockDto,
  UpdateAnalysisBlockDto,
  FindAnalysisBlockDto,
} from './dto/analysis-block.dto';
import { OrderDetail } from '../order-details/order-detail.entity';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';

@Injectable()
export class AnalysisBlockService {
  private readonly logger = new Logger(AnalysisBlockService.name);

  // Cache để tối ưu hiệu suất
  private customerNameCache = new Map<string, string>();
  private cacheExpiry = new Map<string, number>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 phút

  constructor(
    @InjectRepository(AnalysisBlock)
    private readonly analysisBlockRepository: Repository<AnalysisBlock>,
    @InjectRepository(OrderDetail)
    private readonly orderDetailRepository: Repository<OrderDetail>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Department)
    private readonly departmentRepository: Repository<Department>,
  ) {}

  // Quản lý cache
  private getCachedCustomerName(zaloContactId: string): string | null {
    const expiry = this.cacheExpiry.get(zaloContactId);
    if (expiry && Date.now() < expiry) {
      return this.customerNameCache.get(zaloContactId) || null;
    }
    this.customerNameCache.delete(zaloContactId);
    this.cacheExpiry.delete(zaloContactId);
    return null;
  }

  private setCachedCustomerName(zaloContactId: string, customerName: string): void {
    this.customerNameCache.set(zaloContactId, customerName);
    this.cacheExpiry.set(zaloContactId, Date.now() + this.CACHE_TTL);
  }

  async create(createDto: CreateAnalysisBlockDto): Promise<AnalysisBlock> {
    try {
      // Kiểm tra xem đã tồn tại analysis block cho zalo contact này chưa (zaloContactId unique)
      const existing = await this.analysisBlockRepository.findOne({
        where: {
          zaloContactId: createDto.zaloContactId,
        },
      });

      if (existing) {
        throw new ConflictException(
          `Đã tồn tại analysis block cho zalo contact ${createDto.zaloContactId}. Không thể chặn lại đơn của contact này.`,
        );
      }

      const analysisBlock = this.analysisBlockRepository.create(createDto);
      const saved = await this.analysisBlockRepository.save(analysisBlock);
      return saved;
    } catch (error) {
      this.logger.error('Error creating analysis block entry:', error);
      throw error;
    }
  }

  async findAll(
    findDto: FindAnalysisBlockDto,
  ): Promise<{ data: AnalysisBlock[]; total: number }> {
    try {
      const { userId, zaloContactId, blockType, page = 1, limit = 10 } = findDto;
      const queryBuilder =
        this.analysisBlockRepository.createQueryBuilder('analysisBlock');

      if (userId) {
        queryBuilder.andWhere('analysisBlock.userId = :userId', { userId });
      }

      if (zaloContactId) {
        queryBuilder.andWhere('analysisBlock.zaloContactId = :zaloContactId', {
          zaloContactId,
        });
      }

      if (blockType) {
        queryBuilder.andWhere('analysisBlock.blockType = :blockType', {
          blockType,
        });
      }

      queryBuilder
        .orderBy('analysisBlock.created_at', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);

      const [data, total] = await queryBuilder.getManyAndCount();
      return { data, total };
    } catch (error) {
      this.logger.error('Error finding analysis blocks:', error);
      throw error;
    }
  }

  async findOne(id: number): Promise<AnalysisBlock> {
    try {
      const analysisBlock = await this.analysisBlockRepository.findOne({
        where: { id },
        relations: ['user'],
      });

      if (!analysisBlock) {
        throw new NotFoundException(`Analysis block with ID ${id} not found`);
      }

      return analysisBlock;
    } catch (error) {
      this.logger.error(`Error finding analysis block with ID ${id}:`, error);
      throw error;
    }
  }

  async update(id: number, updateDto: UpdateAnalysisBlockDto): Promise<AnalysisBlock> {
    try {
      const analysisBlock = await this.findOne(id);
      
      Object.assign(analysisBlock, updateDto);
      const updated = await this.analysisBlockRepository.save(analysisBlock);
      return updated;
    } catch (error) {
      this.logger.error(`Error updating analysis block with ID ${id}:`, error);
      throw error;
    }
  }

  async remove(id: number): Promise<void> {
    try {
      const analysisBlock = await this.findOne(id);
      await this.analysisBlockRepository.remove(analysisBlock);
    } catch (error) {
      this.logger.error(`Error removing analysis block with ID ${id}:`, error);
      throw error;
    }
  }

  async findByZaloContactId(zaloContactId: string): Promise<AnalysisBlock[]> {
    try {
      return await this.analysisBlockRepository.find({
        where: { zaloContactId },
        relations: ['user'],
      });
    } catch (error) {
      this.logger.error(
        `Error finding analysis blocks for contact ${zaloContactId}:`,
        error,
      );
      throw error;
    }
  }

  async isBlocked(userId: number, zaloContactId: string, blockType: string): Promise<boolean> {
    try {
      const count = await this.analysisBlockRepository.count({
        where: {
          zaloContactId,
        },
      });

      return count > 0;
    } catch (error) {
      this.logger.error(
        `Error checking analysis block status for contact ${zaloContactId}:`,
        error,
      );
      throw error;
    }
  }

  async getBlockedContactsForUser(userId: number, blockType?: string): Promise<string[]> {
    try {
      const where: any = {};
      if (blockType) where.blockType = blockType as 'analysis' | 'reporting' | 'stats';

      const blocks = await this.analysisBlockRepository.find({
        where,
        select: ['zaloContactId'],
      });

      return blocks.map((block) => block.zaloContactId);
    } catch (error) {
      this.logger.error(
        `Error getting blocked contacts:`,
        error,
      );
      throw error;
    }
  }

  // Helper function để extract customer_id từ metadata
  private extractCustomerIdFromMetadata(metadata: any): string | null {
    try {
      if (!metadata) return null;

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
      // Kiểm tra cache trước
      const cachedName = this.getCachedCustomerName(zaloContactId);
      if (cachedName !== null) {
        return cachedName;
      }

      // Query trực tiếp với điều kiện JSON
      const orderDetail = await this.orderDetailRepository
        .createQueryBuilder('od')
        .where('od.metadata IS NOT NULL')
        .andWhere("JSON_EXTRACT(od.metadata, '$.customer_id') = :zaloContactId", {
          zaloContactId,
        })
        .select(['od.customer_name'])
        .getOne();

      const customerName = orderDetail?.customer_name || null;
      
      // Lưu vào cache nếu có kết quả
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

  // Lấy danh sách analysis blocks với phân quyền và thông tin customer
  async findAllWithPermissions(
    currentUser: any,
    filters: {
      page?: number;
      pageSize?: number;
      search?: string;
      departments?: number[];
      users?: number[];
      blockType?: string;
    } = {},
  ): Promise<{ data: any[]; total: number }> {
    try {
      const {
        page = 1,
        pageSize = 10,
        search = '',
        departments = [],
        users = [],
        blockType,
      } = filters;
      const limit = pageSize;
      const offset = (page - 1) * pageSize;

      const userRoles = currentUser.roles
        ? currentUser.roles.map((role) => role.name)
        : [];

      const isAdmin = userRoles.includes('admin');
      
      // Chỉ admin mới được xem analysis blocks
      if (!isAdmin) {
        return { data: [], total: 0 };
      }

      // Tối ưu: Batch query customer names thay vì N+1 queries
      let matchingZaloContactIds: string[] = [];
      if (search && search.trim()) {
        const orderDetails = await this.orderDetailRepository
          .createQueryBuilder('od')
          .where('LOWER(od.customer_name) LIKE LOWER(:search)', {
            search: `%${search.trim()}%`,
          })
          .andWhere('od.metadata IS NOT NULL')
          .select(['od.metadata'])
          .limit(1000)
          .getMany();

        matchingZaloContactIds = orderDetails
          .map((od) => this.extractCustomerIdFromMetadata(od.metadata))
          .filter((id) => id !== null);
      }

      // Tạo main query
      let queryBuilder = this.analysisBlockRepository
        .createQueryBuilder('analysisBlock')
        .leftJoinAndSelect('analysisBlock.user', 'user')
        .leftJoinAndSelect('user.departments', 'departments');

      // Admin có thể xem tất cả analysis blocks (không cần filter thêm)

      // Apply filters
      if (blockType) {
        queryBuilder.andWhere('analysisBlock.blockType = :blockType', {
          blockType: blockType as 'analysis' | 'reporting' | 'stats',
        });
      }

      if (departments.length > 0) {
        const deptIds = departments.join(',');
        queryBuilder.andWhere(
          `analysisBlock.userId IN (SELECT u2.id FROM users u2 JOIN users_departments ud2 ON u2.id = ud2.user_id WHERE ud2.department_id IN (${deptIds}))`,
        );
      }

      if (users.length > 0) {
        queryBuilder.andWhere('analysisBlock.userId IN (:...userIds)', {
          userIds: users,
        });
      }

      if (search && matchingZaloContactIds.length > 0) {
        queryBuilder.andWhere('analysisBlock.zaloContactId IN (:...contactIds)', {
          contactIds: matchingZaloContactIds,
        });
      }

      // Count total
      const total = await queryBuilder.getCount();

      // Apply pagination
      queryBuilder
        .orderBy('analysisBlock.created_at', 'DESC')
        .skip(offset)
        .take(limit);

      const analysisBlocks = await queryBuilder.getMany();

      // Enrich với customer names
      const enrichedData = await Promise.all(
        analysisBlocks.map(async (block) => {
          const customerName = await this.getCustomerNameByZaloContactId(
            block.zaloContactId,
          );
          return {
            ...block,
            customerName,
          };
        }),
      );

      return { data: enrichedData, total };
    } catch (error) {
      this.logger.error('Error finding analysis blocks with permissions:', error);
      throw error;
    }
  }

  // Lấy departments cho filter
  async getDepartmentsForFilter(
    currentUser: any,
    userIds: number[] = [],
  ): Promise<Array<{ value: number; label: string }>> {
    try {
      const userRoles = currentUser.roles
        ? currentUser.roles.map((role) => role.name)
        : [];

      const isAdmin = userRoles.includes('admin');
      
      // Chỉ admin mới được xem departments
      if (!isAdmin) {
        return [];
      }

      let queryBuilder = this.departmentRepository
        .createQueryBuilder('d')
        .select(['d.id', 'd.name']);

      if (userIds.length > 0) {
        queryBuilder.andWhere(
          'd.id IN (SELECT ud2.department_id FROM users_departments ud2 WHERE ud2.user_id IN (:...userIds))',
          { userIds },
        );
      }

      const departments = await queryBuilder.getMany();
      return departments.map((dept) => ({
        value: dept.id,
        label: dept.name,
      }));
    } catch (error) {
      this.logger.error('Error getting departments for filter:', error);
      throw error;
    }
  }

  // Lấy users cho filter
  async getUsersForFilter(
    currentUser: any,
    departmentIds: number[] = [],
  ): Promise<Array<{ value: number; label: string }>> {
    try {
      const userRoles = currentUser.roles
        ? currentUser.roles.map((role) => role.name)
        : [];

      const isAdmin = userRoles.includes('admin');
      
      // Chỉ admin mới được xem users
      if (!isAdmin) {
        return [];
      }

      let queryBuilder = this.userRepository
        .createQueryBuilder('u')
        .select(['u.id', 'u.fullName', 'u.username']);

      if (departmentIds.length > 0) {
        queryBuilder.andWhere(
          'u.id IN (SELECT ud.user_id FROM users_departments ud WHERE ud.department_id IN (:...departmentIds))',
          { departmentIds },
        );
      }

      const users = await queryBuilder.getMany();
      return users.map((user) => ({
        value: user.id,
        label: user.fullName || user.username || `User ${user.id}`,
      }));
    } catch (error) {
      this.logger.error('Error getting users for filter:', error);
      throw error;
    }
  }
}
