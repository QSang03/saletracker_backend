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
} from '@nestjs/common';
import { DepartmentService } from './department.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { Request } from 'express';

@Controller('departments')
@UseGuards(AuthGuard)
export class DepartmentController {
  constructor(
    private readonly departmentService: DepartmentService,
  ) {}

  @Get()
  async findAll(@Req() req: Request) {
    const token = req.headers.authorization?.split(' ')[1] || '';
    return this.departmentService.findAll(token);
  }

  @Post()
  async create(
    @Body() createDepartmentDto: CreateDepartmentDto,
    @Req() req: Request,
  ) {
    const token = req.headers.authorization?.split(' ')[1] || '';
    return this.departmentService.createDepartment(
      createDepartmentDto,
      '',
      token,
    );
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDepartmentDto: UpdateDepartmentDto,
    @Req() req: Request,
  ) {
    const token = req.headers.authorization?.split(' ')[1] || '';
    return this.departmentService.updateDepartment(
      +id,
      updateDepartmentDto,
      token,
    );
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const token = req.headers.authorization?.split(' ')[1] || '';
    return this.departmentService.softDeleteDepartment(+id, token);
  }
}
