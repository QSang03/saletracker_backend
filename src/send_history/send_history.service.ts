import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SendHistory } from './send_history.entity';

@Injectable()
export class SendHistoryService {
  constructor(
    @InjectRepository(SendHistory)
    private readonly repo: Repository<SendHistory>,
  ) {}

  async query(filter: {
    zalo_customer_id?: string;
    user_id?: number;
    send_function?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
    notes?: string;
  }) {
    try {
      console.log('Send history service query with filter:', filter);
      
      const qb = this.repo.createQueryBuilder('sh')
        .leftJoinAndSelect('sh.user', 'user')
        .orderBy('sh.created_at', 'DESC');

      if (filter.zalo_customer_id) {
        qb.andWhere('sh.zaloCustomerId = :zalo', { zalo: filter.zalo_customer_id });
      }

      if (filter.user_id) {
        qb.andWhere('sh.user.id = :uid', { uid: filter.user_id });
      }

      if (filter.send_function) {
        qb.andWhere('sh.sendFunction = :sf', { sf: filter.send_function });
      }

      if (filter.from) {
        qb.andWhere('sh.sent_at >= :from', { from: filter.from });
      }

      if (filter.to) {
        qb.andWhere('sh.sent_at <= :to', { to: filter.to });
      }

      if (filter.notes) {
        qb.andWhere('sh.notes LIKE :notes', { notes: `%${filter.notes}%` });
      }

      const page = filter.page && filter.page > 0 ? filter.page : 1;
      const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 20;

      console.log('Query SQL:', qb.getSql());
      console.log('Query parameters:', qb.getParameters());

      const [data, total] = await qb
        .skip((page - 1) * pageSize)
        .take(pageSize)
        .getManyAndCount();

      console.log(`Found ${total} records, returning ${data.length} for page ${page}`);

      return {
        data,
        total,
        page,
        pageSize,
      };
    } catch (error) {
      console.error('Error in send history service:', error);
      throw error;
    }
  }
}
