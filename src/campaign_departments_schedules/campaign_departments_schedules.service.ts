import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder, IsNull, Not, In } from 'typeorm';
import {
  DepartmentSchedule,
  ScheduleStatus,
} from './campaign_departments_schedules.entity';
import { CreateDepartmentScheduleDto } from './dto/create-department-schedule.dto';
import { UpdateDepartmentScheduleDto } from './dto/update-department-schedule.dto';
import { QueryDepartmentScheduleDto } from './dto/query-department-schedule.dto';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';

@Injectable()
export class CampaignDepartmentsSchedulesService {
  constructor(
    @InjectRepository(DepartmentSchedule)
    private readonly departmentScheduleRepository: Repository<DepartmentSchedule>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Department)
    private readonly departmentRepository: Repository<Department>,
  ) {}

  async create(
    createDto: CreateDepartmentScheduleDto,
    userId: number,
  ): Promise<DepartmentSchedule> {
    try {
      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      console.log('🔍 VALIDATING SCHEDULE CONFIG');
      console.log('📝 Schedule type:', createDto.schedule_type);
      console.log('📋 Config:', JSON.stringify(createDto.schedule_config, null, 2));

      // Validate schedule configuration
      const isValidConfig = await this.validateScheduleConfig(
        createDto.schedule_config,
        createDto.schedule_type,
      );

      if (!isValidConfig) {
        console.log('❌ INVALID SCHEDULE CONFIG');
        throw new BadRequestException('Invalid schedule configuration');
      }

      console.log('✅ SCHEDULE CONFIG VALID');

      const schedule = this.departmentScheduleRepository.create({
        ...createDto,
        department: { id: createDto.department_id } as any,
        created_by: { id: userId } as any,
        status: createDto.status || ScheduleStatus.ACTIVE,
      });

      const savedSchedule =
        await this.departmentScheduleRepository.save(schedule);
      return savedSchedule;
    } catch (error) {
      console.error('=== CREATE SCHEDULE ERROR ===');
      console.error('Error details:', error);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to create department schedule: ${error.message}`);
    }
  }

  async findAll(query: QueryDepartmentScheduleDto): Promise<{
    data: DepartmentSchedule[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const {
      name,
      schedule_type,
      status,
      department_id,
      page = 1,
      limit = 999999,
      sort = 'created_at',
      order = 'DESC',
    } = query;

    const queryBuilder: SelectQueryBuilder<DepartmentSchedule> =
      this.departmentScheduleRepository
        .createQueryBuilder('schedule')
        .leftJoinAndSelect('schedule.department', 'department')
        .leftJoinAndSelect('schedule.created_by', 'created_by')
        .where('schedule.deleted_at IS NULL');

    // Apply filters
    if (name) {
      queryBuilder.andWhere('schedule.name LIKE :name', { name: `%${name}%` });
    }

    if (schedule_type) {
      queryBuilder.andWhere('schedule.schedule_type = :schedule_type', {
        schedule_type,
      });
    }

    if (status) {
      queryBuilder.andWhere('schedule.status = :status', { status });
    }

    if (department_id) {
      queryBuilder.andWhere('schedule.department.id = :department_id', {
        department_id,
      });
    }

    // Apply sorting
    const validSortFields = [
      'name',
      'schedule_type',
      'status',
      'created_at',
      'updated_at',
    ];
    const sortField = validSortFields.includes(sort) ? sort : 'created_at';
    queryBuilder.orderBy(`schedule.${sortField}`, order);

    // Apply pagination - nếu limit = -1 thì không giới hạn
    if (limit > 0) {
      const offset = (page - 1) * limit;
      queryBuilder.skip(offset).take(limit);
    }

    const [data, total] = await queryBuilder.getManyAndCount();
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findOne(id: string): Promise<DepartmentSchedule> {
    const schedule = await this.departmentScheduleRepository.findOne({
      where: { id, deleted_at: IsNull() },
      relations: ['department', 'created_by'],
    });

    if (!schedule) {
      throw new NotFoundException(
        `Department schedule with ID ${id} not found`,
      );
    }

    return schedule;
  }

  async update(
    id: string,
    updateDto: UpdateDepartmentScheduleDto,
  ): Promise<DepartmentSchedule> {
    const schedule = await this.findOne(id);

    try {
      Object.assign(schedule, updateDto);
      return await this.departmentScheduleRepository.save(schedule);
    } catch (error) {
      throw new BadRequestException('Failed to update department schedule');
    }
  }

  async remove(id: string): Promise<void> {
    const schedule = await this.findOne(id);

    try {
      await this.departmentScheduleRepository.softDelete(id);
    } catch (error) {
      throw new BadRequestException('Failed to delete department schedule');
    }
  }

  async findByDepartment(departmentId: number): Promise<DepartmentSchedule[]> {
    return await this.departmentScheduleRepository.find({
      where: {
        department: { id: departmentId },
        deleted_at: IsNull(),
        status: ScheduleStatus.ACTIVE,
      },
      relations: ['department', 'created_by'],
      order: { created_at: 'DESC' },
    });
  }

  async updateStatus(
    id: string,
    status: ScheduleStatus,
  ): Promise<DepartmentSchedule> {
    const schedule = await this.findOne(id);
    schedule.status = status;
    return await this.departmentScheduleRepository.save(schedule);
  }

  async getActiveSchedules(): Promise<DepartmentSchedule[]> {
    return await this.departmentScheduleRepository.find({
      where: {
        status: ScheduleStatus.ACTIVE,
        deleted_at: IsNull(),
      },
      relations: ['department', 'created_by'],
      order: { created_at: 'DESC' },
    });
  }

  async validateScheduleConfig(
    schedule_config: any,
    schedule_type: string,
  ): Promise<boolean> {
    try {
      console.log('🔍 VALIDATING CONFIG FOR TYPE:', schedule_type);
      console.log('📋 Config received:', JSON.stringify(schedule_config, null, 2));

      if (schedule_type === 'daily_dates') {
        console.log('📅 Validating daily_dates config');
        if (!schedule_config.dates || !Array.isArray(schedule_config.dates)) {
          console.log('❌ No dates array found');
          return false;
        }

        for (const date of schedule_config.dates) {
          console.log('🔍 Checking date:', date);
          if (
            !date.day_of_month ||
            date.day_of_month < 1 ||
            date.day_of_month > 31
          ) {
            console.log('❌ Invalid day_of_month:', date.day_of_month);
            return false;
          }
          if (date.month && (date.month < 1 || date.month > 12)) {
            console.log('❌ Invalid month:', date.month);
            return false;
          }
        }
        console.log('✅ daily_dates validation passed');
      } else if (schedule_type === 'hourly_slots') {
        console.log('⏰ Validating hourly_slots config');
        if (!schedule_config.slots || !Array.isArray(schedule_config.slots)) {
          console.log('❌ No slots array found');
          return false;
        }

        for (const slot of schedule_config.slots) {
          console.log('🔍 Checking slot:', slot);
          if (!slot.start_time || !slot.end_time) {
            console.log('❌ Missing start_time or end_time:', { start_time: slot.start_time, end_time: slot.end_time });
            return false;
          }
          if (
            slot.day_of_week !== undefined &&
            (slot.day_of_week < 2 || slot.day_of_week > 7)
          ) {
            console.log('❌ Invalid day_of_week (must be 2-7, no Sunday):', slot.day_of_week);
            return false;
          }
        }
        console.log('✅ hourly_slots validation passed');
      }

      return true;
    } catch (error) {
      console.log('❌ Validation error:', error);
      return false;
    }
  }

  // Kiểm tra quyền thao tác department của user (create/update/delete)
  async canUserAccessDepartment(userId: number, departmentId: number): Promise<boolean> {
    try {
      console.log('🔍 CAN USER ACCESS DEPARTMENT');
      console.log('👤 User ID:', userId);
      console.log('🏢 Department ID:', departmentId);

      const editableDepartmentIds = await this.getEditableDepartmentIds(userId);
      console.log('📋 Editable department IDs:', editableDepartmentIds);

      const canAccess = editableDepartmentIds.includes(departmentId);
      console.log('✅ Can access result:', canAccess);

      return canAccess;
    } catch (error) {
      console.error('❌ Error checking department access:', error);
      return false;
    }
  }

  // Lấy tất cả schedules với filter theo quyền user
  async findAllForUser(query: QueryDepartmentScheduleDto, userId: number): Promise<{
    data: DepartmentSchedule[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    // Tất cả user đều có thể view tất cả schedules của departments có server_ip
    const accessibleDepartmentIds = await this.getAllDepartmentsWithServerIP();
    
    if (accessibleDepartmentIds.length === 0) {
      return {
        data: [],
        total: 0,
        page: query.page || 1,
        limit: query.limit || 10,
        totalPages: 0,
      };
    }

    // Thêm filter department_id vào query
    const filteredQuery = {
      ...query,
      department_ids: accessibleDepartmentIds,
    };

    return this.findAllWithDepartmentFilter(filteredQuery);
  }

  // Lấy active schedules với filter theo quyền user
  async getActiveSchedulesForUser(userId: number): Promise<DepartmentSchedule[]> {
    // Tất cả user đều có thể view tất cả active schedules của departments có server_ip
    const accessibleDepartmentIds = await this.getAllDepartmentsWithServerIP();
    
    if (accessibleDepartmentIds.length === 0) {
      return [];
    }

    return await this.departmentScheduleRepository
      .createQueryBuilder('schedule')
      .leftJoinAndSelect('schedule.department', 'department')
      .leftJoinAndSelect('schedule.created_by', 'created_by')
      .where('schedule.status = :status', { status: ScheduleStatus.ACTIVE })
      .andWhere('schedule.deleted_at IS NULL')
      .andWhere('department.id IN (:...departmentIds)', { departmentIds: accessibleDepartmentIds })
      .orderBy('schedule.created_at', 'DESC')
      .getMany();
  }

  // Helper method để lấy tất cả departments có server_ip
  private async getAllDepartmentsWithServerIP(): Promise<number[]> {
    try {
      const departments = await this.departmentRepository.find({
        where: { server_ip: Not(IsNull()) },
      });
      return departments.map(dept => dept.id);
    } catch (error) {
      console.error('Error getting departments with server IP:', error);
      return [];
    }
  }

  // Helper method để lấy danh sách department IDs mà user có quyền thao tác (không phải chỉ view)
  private async getEditableDepartmentIds(userId: number): Promise<number[]> {
    try {
      console.log('🔍 Getting editable departments for user:', userId);
      
      const user = await this.userRepository.findOne({
        where: { id: userId },
        relations: ['roles'],
      });

      if (!user) {
        console.log('❌ User not found');
        return [];
      }

      console.log('👤 User roles:', user.roles.map(r => r.name));

      const isAdminOrScheduler = user.roles.some(role => 
        role.name === 'admin' || role.name === 'scheduler'
      );

      console.log('🔑 Is admin or scheduler:', isAdminOrScheduler);

      if (isAdminOrScheduler) {
        // Admin và scheduler có thể thao tác tất cả departments có server_ip
        const departments = await this.departmentRepository.find({
          where: { server_ip: Not(IsNull()) },
        });
        console.log('🏢 Admin can access departments:', departments.map(d => ({ id: d.id, name: d.name, slug: d.slug })));
        return departments.map(dept => dept.id);
      }

      // Lấy departments mà user là manager
      const managerRoles = user.roles.filter(role => role.name.startsWith('manager-'));
      console.log('👔 Manager roles found:', managerRoles.map(r => r.name));
      
      const departmentSlugs = managerRoles.map(role => role.name.replace('manager-', ''));
      console.log('📂 Department slugs:', departmentSlugs);
      
      if (departmentSlugs.length === 0) {
        console.log('⚠️ No manager roles found');
        return [];
      }

      const departments = await this.departmentRepository.find({
        where: { 
          slug: In(departmentSlugs),
          server_ip: Not(IsNull())
        },
      });

      console.log('🏢 Manager can access departments:', departments.map(d => ({ id: d.id, name: d.name, slug: d.slug })));
      return departments.map(dept => dept.id);
    } catch (error) {
      console.error('❌ Error getting editable departments:', error);
      return [];
    }
  }

  // Helper method để find all với filter departments
  private async findAllWithDepartmentFilter(query: QueryDepartmentScheduleDto & { department_ids?: number[] }): Promise<{
    data: DepartmentSchedule[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const {
      name,
      schedule_type,
      status,
      department_id,
      department_ids,
      page = 1,
      limit = 999999,
      sort = 'created_at',
      order = 'DESC',
    } = query;

    const queryBuilder: SelectQueryBuilder<DepartmentSchedule> =
      this.departmentScheduleRepository
        .createQueryBuilder('schedule')
        .leftJoinAndSelect('schedule.department', 'department')
        .leftJoinAndSelect('schedule.created_by', 'created_by')
        .where('schedule.deleted_at IS NULL');

    // Apply filters
    if (name) {
      queryBuilder.andWhere('schedule.name LIKE :name', { name: `%${name}%` });
    }

    if (schedule_type) {
      queryBuilder.andWhere('schedule.schedule_type = :schedule_type', {
        schedule_type,
      });
    }

    if (status) {
      queryBuilder.andWhere('schedule.status = :status', { status });
    }

    if (department_id) {
      queryBuilder.andWhere('schedule.department.id = :department_id', {
        department_id,
      });
    }

    // Filter by accessible departments
    if (department_ids && department_ids.length > 0) {
      queryBuilder.andWhere('department.id IN (:...department_ids)', {
        department_ids,
      });
    }

    // Apply sorting
    const validSortFields = [
      'name',
      'schedule_type',
      'status',
      'created_at',
      'updated_at',
    ];
    const sortField = validSortFields.includes(sort) ? sort : 'created_at';
    queryBuilder.orderBy(`schedule.${sortField}`, order);

    // Apply pagination - nếu limit = -1 thì không giới hạn
    if (limit > 0) {
      const offset = (page - 1) * limit;
      queryBuilder.skip(offset).take(limit);
    }

    const [data, total] = await queryBuilder.getManyAndCount();
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }
}
