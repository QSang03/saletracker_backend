import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { CampaignDepartmentsSchedulesService } from './campaign_departments_schedules.service';
import { ScheduleStatusUpdaterService } from '../cronjobs/schedule-status-updater.service';
import { CreateDepartmentScheduleDto } from './dto/create-department-schedule.dto';
import { UpdateDepartmentScheduleDto } from './dto/update-department-schedule.dto';
import { QueryDepartmentScheduleDto } from './dto/query-department-schedule.dto';
import { ScheduleStatus } from './campaign_departments_schedules.entity';
import { AuthGuard } from '@nestjs/passport';

@Controller('campaign-departments-schedules')
@UseGuards(AuthGuard('jwt'))
export class CampaignDepartmentsSchedulesController {
  constructor(
    private readonly campaignDepartmentsSchedulesService: CampaignDepartmentsSchedulesService,
    private readonly scheduleStatusUpdaterService: ScheduleStatusUpdaterService,
  ) {}

  @Post()
  async create(
    @Body() createDto: CreateDepartmentScheduleDto,
    @Request() req: any,
  ) {
    console.log('🎯 CREATE SCHEDULE REQUEST');
    console.log('📝 CreateDto:', createDto);
    console.log('👤 User ID:', req.user?.id);
    console.log('🏢 Department ID:', createDto.department_id);

    // Kiểm tra quyền truy cập department
    const canAccessDepartment =
      await this.campaignDepartmentsSchedulesService.canUserAccessDepartment(
        req.user?.id,
        createDto.department_id,
      );

    console.log('🔐 Can access department:', canAccessDepartment);

    if (!canAccessDepartment) {
      console.log('❌ Access denied for department:', createDto.department_id);
      throw new BadRequestException(
        'You do not have permission to create schedules for this department',
      );
    }

    // Validate schedule config before creating
    const isValidConfig =
      await this.campaignDepartmentsSchedulesService.validateScheduleConfig(
        createDto.schedule_config,
        createDto.schedule_type,
      );

    if (!isValidConfig) {
      throw new BadRequestException('Invalid schedule configuration');
    }

    console.log('✅ Creating schedule...');
    return this.campaignDepartmentsSchedulesService.create(
      createDto,
      req.user?.id,
    );
  }

  @Get()
  async findAll(
    @Query() query: QueryDepartmentScheduleDto,
    @Request() req: any,
  ) {
    return this.campaignDepartmentsSchedulesService.findAllForUser(
      query,
      req.user?.id,
    );
  }

  @Get('active')
  async getActiveSchedules(@Request() req: any) {
    return this.campaignDepartmentsSchedulesService.getActiveSchedulesForUser(
      req.user?.id,
    );
  }

  @Get('department/:departmentId')
  async findByDepartment(
    @Param('departmentId', ParseIntPipe) departmentId: number,
  ) {
    // Tất cả user đều có thể view schedules của department
    return this.campaignDepartmentsSchedulesService.findByDepartment(
      departmentId,
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.campaignDepartmentsSchedulesService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateDepartmentScheduleDto,
    @Request() req: any,
  ) {
    console.log('📝 UPDATE SCHEDULE REQUEST');
    console.log('🆔 Schedule ID:', id);
    console.log('📝 UpdateDto:', updateDto);
    console.log('👤 User ID:', req.user?.id);

    // Lấy thông tin schedule hiện tại để kiểm tra department
    const existingSchedule =
      await this.campaignDepartmentsSchedulesService.findOne(id);
    console.log(
      '📋 Existing schedule department:',
      existingSchedule.department,
    );

    // Kiểm tra quyền truy cập department hiện tại
    const canAccessCurrentDept =
      await this.campaignDepartmentsSchedulesService.canUserAccessDepartment(
        req.user?.id,
        existingSchedule.department.id,
      );

    console.log('🔐 Can access current department:', canAccessCurrentDept);

    if (!canAccessCurrentDept) {
      console.log(
        '❌ Access denied for current department:',
        existingSchedule.department.id,
      );
      throw new BadRequestException(
        'You do not have permission to update schedules for this department',
      );
    }

    // Nếu có thay đổi department_id, kiểm tra quyền truy cập department mới
    if (
      updateDto.department_id &&
      updateDto.department_id !== existingSchedule.department.id
    ) {
      console.log(
        '🔄 Department change detected:',
        existingSchedule.department.id,
        '->',
        updateDto.department_id,
      );

      const canAccessNewDept =
        await this.campaignDepartmentsSchedulesService.canUserAccessDepartment(
          req.user?.id,
          updateDto.department_id,
        );

      console.log('🔐 Can access new department:', canAccessNewDept);

      if (!canAccessNewDept) {
        console.log(
          '❌ Access denied for new department:',
          updateDto.department_id,
        );
        throw new BadRequestException(
          'You do not have permission to move schedules to this department',
        );
      }
    }

    // Validate schedule config if provided
    if (updateDto.schedule_config && updateDto.schedule_type) {
      const isValidConfig =
        await this.campaignDepartmentsSchedulesService.validateScheduleConfig(
          updateDto.schedule_config,
          updateDto.schedule_type,
        );

      if (!isValidConfig) {
        throw new BadRequestException('Invalid schedule configuration');
      }
    }

    console.log('✅ Updating schedule...');
    return this.campaignDepartmentsSchedulesService.update(id, updateDto);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: ScheduleStatus,
    @Request() req: any,
  ) {
    if (!Object.values(ScheduleStatus).includes(status)) {
      throw new BadRequestException('Invalid status value');
    }

    // Kiểm tra quyền truy cập department
    const schedule = await this.campaignDepartmentsSchedulesService.findOne(id);
    const canAccessDepartment =
      await this.campaignDepartmentsSchedulesService.canUserAccessDepartment(
        req.user?.id,
        schedule.department.id,
      );

    if (!canAccessDepartment) {
      throw new BadRequestException(
        'You do not have permission to update schedules for this department',
      );
    }

    return this.campaignDepartmentsSchedulesService.updateStatus(id, status);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: any) {
    // Kiểm tra quyền truy cập department
    const schedule = await this.campaignDepartmentsSchedulesService.findOne(id);
    const canAccessDepartment =
      await this.campaignDepartmentsSchedulesService.canUserAccessDepartment(
        req.user?.id,
        schedule.department.id,
      );

    if (!canAccessDepartment) {
      throw new BadRequestException(
        'You do not have permission to delete schedules for this department',
      );
    }

    await this.campaignDepartmentsSchedulesService.remove(id);
    return { message: 'Department schedule deleted successfully' };
  }

  @Post('manual-update-statuses')
  async manualUpdateScheduleStatuses(@Request() req: any) {
    // Chỉ admin mới được phép trigger manual update
    if (!req.user?.is_admin) {
      throw new BadRequestException(
        'Chỉ admin mới được phép trigger manual update schedule statuses',
      );
    }

    return this.scheduleStatusUpdaterService.manualUpdateScheduleStatuses();
  }

  @Get('status-stats')
  async getScheduleStatusStats(@Request() req: any) {
    // Chỉ admin mới được phép xem thống kê
    if (!req.user?.is_admin) {
      throw new BadRequestException(
        'Chỉ admin mới được phép xem thống kê schedule status',
      );
    }

    return this.scheduleStatusUpdaterService.getScheduleStatusStats();
  }
}
