import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Department } from './department.entity';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentService {
  updateDepartment(arg0: number, updateDepartmentDto: UpdateDepartmentDto, token: string) {
    throw new Error('Method not implemented.');
  }
  softDeleteDepartment(arg0: number, token: string) {
    throw new Error('Method not implemented.');
  }
  createDepartment(createDepartmentDto: CreateDepartmentDto, _token: string, token: string) {
    throw new Error('Method not implemented.');
  }
  constructor(
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>
  ) {}

  async findAll(token: string): Promise<Department[]> {
    return this.departmentRepo.find();
  }
}