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
import { CreateDepartmentScheduleDto } from './dto/create-department-schedule.dto';
import { UpdateDepartmentScheduleDto } from './dto/update-department-schedule.dto';
import { QueryDepartmentScheduleDto } from './dto/query-department-schedule.dto';
import { ScheduleStatus } from './campaign_departments_schedules.entity';
import { AuthGuard } from '@nestjs/passport';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { ScheduleStatusUpdaterService } from '../cronjobs/schedule-status-updater.service';

@Controller('campaign-departments-schedules')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
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
    // Validate schedule config before creating
    const isValidConfig = await this.campaignDepartmentsSchedulesService.validateScheduleConfig(
      createDto.schedule_config,
      createDto.schedule_type,
    );

    if (!isValidConfig) {
      throw new BadRequestException('Invalid schedule configuration');
    }

    return this.campaignDepartmentsSchedulesService.create(createDto, req.user?.id);
  }

  @Get()
  async findAll(@Query() query: QueryDepartmentScheduleDto) {
    return this.campaignDepartmentsSchedulesService.findAll(query);
  }

  @Get('active')
  async getActiveSchedules() {
    return this.campaignDepartmentsSchedulesService.getActiveSchedules();
  }

  @Get('department/:departmentId')
  async findByDepartment(@Param('departmentId', ParseIntPipe) departmentId: number) {
    return this.campaignDepartmentsSchedulesService.findByDepartment(departmentId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.campaignDepartmentsSchedulesService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateDepartmentScheduleDto,
  ) {
    // Validate schedule config if provided
    if (updateDto.schedule_config && updateDto.schedule_type) {
      const isValidConfig = await this.campaignDepartmentsSchedulesService.validateScheduleConfig(
        updateDto.schedule_config,
        updateDto.schedule_type,
      );

      if (!isValidConfig) {
        throw new BadRequestException('Invalid schedule configuration');
      }
    }

    return this.campaignDepartmentsSchedulesService.update(id, updateDto);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: ScheduleStatus,
  ) {
    if (!Object.values(ScheduleStatus).includes(status)) {
      throw new BadRequestException('Invalid status value');
    }

    return this.campaignDepartmentsSchedulesService.updateStatus(id, status);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.campaignDepartmentsSchedulesService.remove(id);
    return { message: 'Department schedule deleted successfully' };
  }

  @Post('update-statuses')
  async manualUpdateStatuses() {
    const result = await this.scheduleStatusUpdaterService.manualUpdateScheduleStatuses();
    return {
      message: 'Schedule statuses updated successfully',
      ...result
    };
  }

  @Get('status-stats')
  async getStatusStats() {
    return this.scheduleStatusUpdaterService.getScheduleStatusStats();
  }
}
