import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder, IsNull } from 'typeorm';
import {
  DepartmentSchedule,
  ScheduleStatus,
} from './campaign_departments_schedules.entity';
import { CreateDepartmentScheduleDto } from './dto/create-department-schedule.dto';
import { UpdateDepartmentScheduleDto } from './dto/update-department-schedule.dto';
import { QueryDepartmentScheduleDto } from './dto/query-department-schedule.dto';

@Injectable()
export class CampaignDepartmentsSchedulesService {
  constructor(
    @InjectRepository(DepartmentSchedule)
    private readonly departmentScheduleRepository: Repository<DepartmentSchedule>,
  ) {}

  async create(
    createDto: CreateDepartmentScheduleDto,
    userId: number,
  ): Promise<DepartmentSchedule> {
    try {
      console.log('=== DEBUG CREATE SCHEDULE ===');
      console.log('CreateDto:', JSON.stringify(createDto, null, 2));
      console.log('UserId:', userId);

      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      const schedule = this.departmentScheduleRepository.create({
        ...createDto,
        department: { id: createDto.department_id } as any,
        created_by: { id: userId } as any,
        status: createDto.status || ScheduleStatus.ACTIVE,
      });

      console.log(
        'Schedule entity before save:',
        JSON.stringify(schedule, null, 2),
      );

      const savedSchedule =
        await this.departmentScheduleRepository.save(schedule);
      console.log('Schedule saved successfully:', savedSchedule.id);
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
      limit = 10,
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

    // Apply pagination
    const offset = (page - 1) * limit;
    queryBuilder.skip(offset).take(limit);

    const [data, total] = await queryBuilder.getManyAndCount();
    const totalPages = Math.ceil(total / limit);

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
      if (schedule_type === 'daily_dates') {
        if (!schedule_config.dates || !Array.isArray(schedule_config.dates)) {
          return false;
        }

        for (const date of schedule_config.dates) {
          if (
            !date.day_of_month ||
            date.day_of_month < 1 ||
            date.day_of_month > 31
          ) {
            return false;
          }
          if (date.month && (date.month < 1 || date.month > 12)) {
            return false;
          }
        }
      } else if (schedule_type === 'hourly_slots') {
        if (!schedule_config.slots || !Array.isArray(schedule_config.slots)) {
          return false;
        }

        for (const slot of schedule_config.slots) {
          if (!slot.start_time || !slot.end_time) {
            return false;
          }
          if (
            slot.day_of_week !== undefined &&
            (slot.day_of_week < 0 || slot.day_of_week > 6)
          ) {
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }
}
