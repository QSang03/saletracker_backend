import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DebtLogs } from './debt_logs.entity';

@Injectable()
export class DebtLogsService {
  constructor(
    @InjectRepository(DebtLogs)
    private readonly repo: Repository<DebtLogs>,
  ) {}

  findAll(query?: any): Promise<DebtLogs[]> {
    return this.repo.find();
  }

  async findOne(id: number): Promise<DebtLogs> {
    const found = await this.repo.findOne({ where: { id } });
    if (!found) throw new Error('DebtLog not found');
    return found;
  }

  create(data: Partial<DebtLogs>): Promise<DebtLogs> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  update(id: number, data: Partial<DebtLogs>): Promise<DebtLogs> {
    return this.repo.save({ ...data, id });
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
