import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { CampaignInteractionLog } from './campaign_interaction_log.entity';

export interface InteractionStats {
  total_sent: number;
  total_replies: number;
  total_handled: number;
  response_rate: number;
  handling_rate: number;
}

export interface LogFilter {
  campaign_id?: string;
  status?: string;
  date_from?: Date;
  date_to?: Date;
  customer_phone?: string;
}

@Injectable()
export class CampaignInteractionLogService {
  constructor(
    @InjectRepository(CampaignInteractionLog)
    private readonly campaignInteractionLogRepository: Repository<CampaignInteractionLog>,
  ) {}

  async findAll(filter: LogFilter, page = 1, pageSize = 10): Promise<{
    data: CampaignInteractionLog[];
    total: number;
    stats: InteractionStats;
  }> {
    const qb = this.campaignInteractionLogRepository.createQueryBuilder('log')
      .leftJoinAndSelect('log.campaign', 'campaign')
      .leftJoinAndSelect('log.customer', 'customer')
      .leftJoinAndSelect('log.staff_handler', 'staff');

    // Apply filters
    if (filter.campaign_id) {
      qb.andWhere('campaign.id = :campaignId', { campaignId: filter.campaign_id });
    }
    
    if (filter.status) {
      qb.andWhere('log.status = :status', { status: filter.status });
    }
    
    if (filter.date_from && filter.date_to) {
      qb.andWhere('log.sent_at BETWEEN :dateFrom AND :dateTo', {
        dateFrom: filter.date_from,
        dateTo: filter.date_to,
      });
    }
    
    if (filter.customer_phone) {
      qb.andWhere('customer.phone_number LIKE :phone', { 
        phone: `%${filter.customer_phone}%` 
      });
    }

    // Get stats
    const stats = await this.getStats(filter);

    // Apply pagination
    const skip = (page - 1) * pageSize;
    qb.skip(skip).take(pageSize);
    qb.orderBy('log.sent_at', 'DESC');

    const [data, total] = await qb.getManyAndCount();
    
    return { data, total, stats };
  }

  async getStats(filter: LogFilter): Promise<InteractionStats> {
    const qb = this.campaignInteractionLogRepository.createQueryBuilder('log')
      .leftJoin('log.campaign', 'campaign');

    if (filter.campaign_id) {
      qb.andWhere('campaign.id = :campaignId', { campaignId: filter.campaign_id });
    }
    
    if (filter.date_from && filter.date_to) {
      qb.andWhere('log.sent_at BETWEEN :dateFrom AND :dateTo', {
        dateFrom: filter.date_from,
        dateTo: filter.date_to,
      });
    }

    const total_sent = await qb.andWhere('log.status != :pending', { pending: 'pending' }).getCount();
    
    const total_replies = await qb.clone()
      .andWhere('log.customer_replied_at IS NOT NULL')
      .getCount();
    
    const total_handled = await qb.clone()
      .andWhere('log.staff_handled_at IS NOT NULL')
      .getCount();

    const response_rate = total_sent > 0 ? (total_replies / total_sent) * 100 : 0;
    const handling_rate = total_replies > 0 ? (total_handled / total_replies) * 100 : 0;

    return {
      total_sent,
      total_replies,
      total_handled,
      response_rate: Math.round(response_rate * 100) / 100,
      handling_rate: Math.round(handling_rate * 100) / 100,
    };
  }

  async create(data: Partial<CampaignInteractionLog>): Promise<CampaignInteractionLog> {
    const log = this.campaignInteractionLogRepository.create(data);
    return this.campaignInteractionLogRepository.save(log);
  }

  async updateStatus(id: string, status: string, additionalData?: any): Promise<CampaignInteractionLog> {
    const updateData: any = { status };
    
    // Set timestamps based on status
    if (status === 'sent') {
      updateData.sent_at = new Date();
    } else if (status === 'customer_replied') {
      updateData.customer_replied_at = new Date();
      if (additionalData?.reply_content) {
        updateData.customer_reply_content = additionalData.reply_content;
      }
    } else if (status === 'staff_handled') {
      updateData.staff_handled_at = new Date();
      if (additionalData?.staff_id) {
        updateData.staff_handler = { id: additionalData.staff_id };
      }
      if (additionalData?.staff_reply) {
        updateData.staff_reply_content = additionalData.staff_reply;
      }
    }

    await this.campaignInteractionLogRepository.update(id, updateData);
    return this.findOne(id);
  }

  async findOne(id: string): Promise<CampaignInteractionLog> {
    const log = await this.campaignInteractionLogRepository.findOne({
      where: { id },
      relations: ['campaign', 'customer', 'staff_handler'],
    });
    
    if (!log) {
      throw new BadRequestException('Không tìm thấy log');
    }
    
    return log;
  }

  async getByCampaign(campaignId: string): Promise<CampaignInteractionLog[]> {
    return this.campaignInteractionLogRepository.find({
      where: { campaign: { id: campaignId } },
      relations: ['customer', 'staff_handler'],
      order: { sent_at: 'DESC' },
    });
  }

  async getByCustomer(customerId: string): Promise<CampaignInteractionLog[]> {
    return this.campaignInteractionLogRepository.find({
      where: { customer: { id: customerId } },
      relations: ['campaign', 'staff_handler'],
      order: { sent_at: 'DESC' },
    });
  }

  async update(id: string, data: Partial<CampaignInteractionLog>): Promise<CampaignInteractionLog> {
    await this.campaignInteractionLogRepository.update(id, data);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.campaignInteractionLogRepository.delete(id);
  }
}
