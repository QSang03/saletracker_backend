import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DebtHistory } from './debt_histories.entity';

@Injectable()
export class DebtHistoryService {
  constructor(
    @InjectRepository(DebtHistory)
    private readonly debtHistoryRepository: Repository<DebtHistory>,
  ) {}

  async findAll(): Promise<DebtHistory[]> {
    return this.debtHistoryRepository.find();
  }

  async findOne(id: number): Promise<DebtHistory> {
    const history = await this.debtHistoryRepository.findOne({ where: { id } });
    if (!history) throw new NotFoundException('DebtHistory not found');
    return history;
  }

  async create(data: Partial<DebtHistory>): Promise<DebtHistory> {
    const history = this.debtHistoryRepository.create(data);
    return this.debtHistoryRepository.save(history);
  }

  async update(id: number, data: Partial<DebtHistory>): Promise<DebtHistory> {
    await this.debtHistoryRepository.update(id, data);
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    await this.debtHistoryRepository.delete(id);
  }
}
