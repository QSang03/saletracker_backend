import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DebtConfig } from './debt_configs.entity';

@Injectable()
export class DebtConfigService {
  constructor(
    @InjectRepository(DebtConfig)
    private readonly repo: Repository<DebtConfig>,
  ) {}

  findAll(): Promise<DebtConfig[]> {
    return this.repo.find({
      relations: ['debts', 'debt_logs', 'employee', 'actor'],
    });
  }

  async findOne(id: number): Promise<DebtConfig> {
    const config = await this.repo.findOne({
      where: { id },
      relations: ['debts', 'debt_logs', 'employee', 'actor'],
    });
    if (!config) throw new Error('DebtConfig not found');
    return config;
  }

  create(data: Partial<DebtConfig>): Promise<DebtConfig> {
    const entity = this.repo.create(data);
    return this.repo.save(entity);
  }

  update(id: number, data: Partial<DebtConfig>): Promise<DebtConfig> {
    return this.repo.save({ ...data, id });
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
