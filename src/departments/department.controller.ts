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

  // Một số caller cũ gửi `limit` thay vì `pageSize` — chấp nhận cả hai
  // để không âm thầm rơi về default 10 khi tên param sai.
  private parsePage(raw: string | undefined): number {
    const n = parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  private parsePageSize(raw: string | undefined, fallback: number): number {
    const n = parseInt(raw ?? '', 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, 1000);
  }

  @Get()
  async findAll(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const user = req.user;
    return this.departmentService.findAll(
      user,
      this.parsePage(page),
      this.parsePageSize(pageSize ?? limit, 10),
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
    @Query('limit') limit?: string,
  ) {
    const user = req.user;
    return this.departmentService.findDeleted(
      user,
      this.parsePage(page),
      this.parsePageSize(pageSize ?? limit, 20),
    );
  }

  // Endpoint lấy tất cả phòng ban không giới hạn quyền
  @Get('all-unrestricted')
  async getAllDepartmentsUnrestricted() {
    return this.departmentService.findAllActiveWithServerIp();
  }
}
