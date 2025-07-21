import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CampaignInteractionLog } from './campaign_interaction_log.entity';

@Injectable()
export class CampaignInteractionLogService {
  constructor(
    @InjectRepository(CampaignInteractionLog)
    private readonly campaignInteractionLogRepository: Repository<CampaignInteractionLog>,
  ) {}

  async findAll(query: any): Promise<CampaignInteractionLog[]> {
    // Thêm logic filter nếu cần
    return this.campaignInteractionLogRepository.find();
  }

  async findOne(id: string): Promise<CampaignInteractionLog> {
    const log = await this.campaignInteractionLogRepository.findOne({ where: { id } });
    if (!log) throw new Error('Log not found');
    return log;
  }

  async create(data: Partial<CampaignInteractionLog>): Promise<CampaignInteractionLog> {
    const log = this.campaignInteractionLogRepository.create(data);
    return this.campaignInteractionLogRepository.save(log);
  }

  async update(id: string, data: Partial<CampaignInteractionLog>): Promise<CampaignInteractionLog> {
    await this.campaignInteractionLogRepository.update(id, data);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.campaignInteractionLogRepository.delete(id);
  }
}
