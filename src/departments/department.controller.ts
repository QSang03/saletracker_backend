import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { DepartmentService } from './department.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { Request } from 'express';
import { Permission } from 'src/common/guards/permission.decorator';

@Controller('departments')
@UseGuards(AuthGuard)
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  @Get()
  async findAll(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    const user = req.user;
    return this.departmentService.findAll(
      user,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 10,
      search,
    );
  }

  @Get('for-filter')
  @Permission('chien-dich', 'read')
  async getDepartmentsForFilter(@Req() req) {
    return this.departmentService.getDepartmentsForFilter(req.user);
  }

  @Post()
  async create(
    @Body() createDepartmentDto: CreateDepartmentDto,
    @Req() req: Request,
  ) {
    const user = req.user;
    return this.departmentService.createDepartment(createDepartmentDto, user);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDepartmentDto: UpdateDepartmentDto,
    @Req() req: Request,
  ) {
    const user = req.user;
    return this.departmentService.updateDepartment(
      +id,
      updateDepartmentDto,
      user,
    );
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const user = req.user;
    return this.departmentService.softDeleteDepartment(+id, user);
  }

  @Patch(':id/restore')
  async restore(@Param('id') id: string, @Req() req: Request) {
    const user = req.user;
    return this.departmentService.restoreDepartment(+id, user);
  }

  @Get('deleted')
  async getDeletedDepartments(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const user = req.user;
    return this.departmentService.findDeleted(
      user,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    );
  }

  // Endpoint lấy tất cả phòng ban không giới hạn quyền
  @Get('all-unrestricted')
  async getAllDepartmentsUnrestricted() {
    return this.departmentService.findAllActiveWithServerIp();
  }
}
