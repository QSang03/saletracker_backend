import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { CampaignInteractionLog, LogStatus } from './campaign_interaction_log.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { User } from '../users/user.entity';

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
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
  ) {}

  async findAll(filter: LogFilter, page = 1, pageSize = 10, user: User): Promise<{
    data: CampaignInteractionLog[];
    total: number;
    stats: InteractionStats;
  }> {
    const qb = this.campaignInteractionLogRepository.createQueryBuilder('log')
      .leftJoinAndSelect('log.campaign', 'campaign')
      .leftJoinAndSelect('log.customer', 'customer')
      .leftJoinAndSelect('log.staff_handler', 'staff')
      .leftJoinAndSelect('campaign.department', 'department');

    // Filter by user's department
    const userDepartment = user.departments?.[0];
    if (userDepartment) {
      qb.andWhere('department.id = :deptId', { deptId: userDepartment.id });
    }

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
    const stats = await this.getStats(filter, user);

    // Apply pagination
    const skip = (page - 1) * pageSize;
    qb.skip(skip).take(pageSize);
    qb.orderBy('log.sent_at', 'DESC');

    const [data, total] = await qb.getManyAndCount();
    
    return { data, total, stats };
  }

  async getStats(filter: LogFilter, user: User): Promise<InteractionStats> {
    const qb = this.campaignInteractionLogRepository.createQueryBuilder('log')
      .leftJoin('log.campaign', 'campaign')
      .leftJoin('campaign.department', 'department');

    // Filter by user's department
    const userDepartment = user.departments?.[0];
    if (userDepartment) {
      qb.andWhere('department.id = :deptId', { deptId: userDepartment.id });
    }

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

  async create(data: Partial<CampaignInteractionLog>, user: User): Promise<CampaignInteractionLog> {
    const log = this.campaignInteractionLogRepository.create(data);
    return this.campaignInteractionLogRepository.save(log);
  }

  async updateLogStatus(id: string, newStatus: LogStatus, extra: any, userId: string): Promise<CampaignInteractionLog> {
    const log = await this.campaignInteractionLogRepository.findOneByOrFail({ id });
    
    // Validate status transitions
    const validTransitions = {
      [LogStatus.PENDING]: [LogStatus.SENT, LogStatus.FAILED],
      [LogStatus.SENT]: [LogStatus.CUSTOMER_REPLIED, LogStatus.FAILED],
      [LogStatus.CUSTOMER_REPLIED]: [LogStatus.STAFF_HANDLED],
      [LogStatus.STAFF_HANDLED]: [LogStatus.REMINDER_SENT],
      [LogStatus.REMINDER_SENT]: [LogStatus.CUSTOMER_REPLIED, LogStatus.FAILED],
      [LogStatus.FAILED]: [LogStatus.PENDING],
    };

    if (!validTransitions[log.status]?.includes(newStatus)) {
      throw new BadRequestException('Invalid status transition');
    }

    // Update log with additional data
    Object.assign(log, extra);
    log.status = newStatus;

    // Set timestamps based on status
    if (newStatus === LogStatus.SENT) {
      log.sent_at = new Date();
    } else if (newStatus === LogStatus.CUSTOMER_REPLIED) {
      log.customer_replied_at = new Date();
    } else if (newStatus === LogStatus.STAFF_HANDLED) {
      log.staff_handled_at = new Date();
      log.staff_handler = { id: userId } as any;
    }

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
    return this.findOne(id); // Keep without user for compatibility
  }

  async findOne(id: string, user?: User): Promise<CampaignInteractionLog> {
    const qb = this.campaignInteractionLogRepository.createQueryBuilder('log')
      .leftJoinAndSelect('log.campaign', 'campaign')
      .leftJoinAndSelect('log.customer', 'customer')
      .leftJoinAndSelect('log.staff_handler', 'staff_handler')
      .leftJoinAndSelect('campaign.department', 'department')
      .where('log.id = :id', { id });

    // Filter by user's department if user is provided
    if (user) {
      const userDepartment = user.departments?.[0];
      if (userDepartment) {
        qb.andWhere('department.id = :deptId', { deptId: userDepartment.id });
      }
    }

    const log = await qb.getOne();
    
    if (!log) {
      throw new NotFoundException('Không tìm thấy log');
    }
    
    return log;
  }

  async getByCampaign(campaignId: string, user: User): Promise<CampaignInteractionLog[]> {
    // Verify campaign access
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
      relations: ['department']
    });

    if (!campaign) {
      throw new NotFoundException('Không tìm thấy chiến dịch');
    }

    const userDepartment = user.departments?.[0];
    if (userDepartment && campaign.department.id !== userDepartment.id) {
      throw new BadRequestException('Không có quyền truy cập chiến dịch này');
    }

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

  async update(id: string, data: Partial<CampaignInteractionLog>, user: User): Promise<CampaignInteractionLog> {
    await this.findOne(id, user); // Verify access
    await this.campaignInteractionLogRepository.update(id, data);
    return this.findOne(id, user);
  }

  async remove(id: string, user: User): Promise<void> {
    const log = await this.findOne(id, user); // Verify access
    await this.campaignInteractionLogRepository.remove(log);
  }
}
