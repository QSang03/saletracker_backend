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

  async findByDebtConfigId(
    debtConfigId: number,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    data: DebtHistory[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const queryBuilder = this.debtHistoryRepository
      .createQueryBuilder('history')
      .leftJoinAndSelect('history.debt_log', 'debt_log')
      .where('debt_log.debt_config_id = :debtConfigId', { debtConfigId })
      .orderBy('history.created_at', 'DESC');

    // Get total count
    const total = await queryBuilder.getCount();

    // Apply pagination
    const skip = (page - 1) * limit;
    const data = await queryBuilder.skip(skip).take(limit).getMany();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getDebtHistoryDetail(id: number): Promise<any> {
    const history = await this.debtHistoryRepository.findOne({
      where: { id },
      relations: ['debt_log', 'debt_log.debt_config'],
    });

    if (!history) {
      throw new Error('DebtHistory not found');
    }

    return {
      id: history.id,
      customer_code: history.debt_log?.debt_config?.customer_code || '',
      customer_name: history.debt_log?.debt_config?.customer_name || '',
      customer_type: history.debt_log?.debt_config?.customer_type || '',
      // Từ debt_history
      image_url: history.debt_img || null,
      debt_message: history.debt_msg || '',
      remind_message_1: history.first_remind || '',
      remind_message_2: history.second_remind || '',
      business_remind_message: history.sale_msg || '',
      remind_status: history.remind_status || 'Not Sent',
      customer_gender: history.gender || '',
      error_msg: history.error_msg || '',
      send_time: history.send_at ? history.send_at.toISOString() : null,
      remind_time_1: history.first_remind_at
        ? history.first_remind_at.toISOString()
        : null,
      remind_time_2: history.second_remind_at
        ? history.second_remind_at.toISOString()
        : null,
      // Thông tin bổ sung từ debt_config
      is_send: history.debt_log?.debt_config?.is_send || false,
      is_repeat: history.debt_log?.debt_config?.is_repeat || false,
      day_of_week: history.debt_log?.debt_config?.day_of_week || null,
      gap_day: history.debt_log?.debt_config?.gap_day || null,
      send_last_at: history.debt_log?.debt_config?.send_last_at
        ? history.debt_log.debt_config.send_last_at.toISOString()
        : null,
      last_update_at: history.created_at
        ? history.created_at.toISOString()
        : null,
      employee:
        history.user_name && history.full_name
          ? { fullName: history.full_name, username: history.user_name }
          : null,
      conv_id: history.conv_id || '',
    };
  }
}
