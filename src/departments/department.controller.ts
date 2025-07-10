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

@Controller('departments')
@UseGuards(AuthGuard)
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  @Get()
  async findAll(@Req() req: Request) {
    // Lấy user từ request (đã qua AuthGuard)
    const user = req.user;
    return this.departmentService.findAll(user);
  }

  @Post()
  async create(
    @Body() createDepartmentDto: CreateDepartmentDto,
    @Req() req: Request,
  ) {
    const user = req.user;
    return this.departmentService.createDepartment(
      createDepartmentDto,
      user,
    );
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
}
