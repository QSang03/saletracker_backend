import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CampaignSchedule } from './campaign_schedule.entity';

@Injectable()
export class CampaignScheduleService {
  constructor(
    @InjectRepository(CampaignSchedule)
    private readonly campaignScheduleRepository: Repository<CampaignSchedule>,
  ) {}

  async getByCampaign(campaign_id: string): Promise<CampaignSchedule> {
    const schedule = await this.campaignScheduleRepository.findOne({ where: { campaign: { id: campaign_id } } });
    if (!schedule) throw new Error('Schedule not found');
    return schedule;
  }

  async create(data: Partial<CampaignSchedule>): Promise<CampaignSchedule> {
    const schedule = this.campaignScheduleRepository.create(data);
    return this.campaignScheduleRepository.save(schedule);
  }

  async update(id: string, data: Partial<CampaignSchedule>): Promise<CampaignSchedule> {
    await this.campaignScheduleRepository.update(id, data);
    return this.getById(id);
  }

  async getById(id: string): Promise<CampaignSchedule> {
    const schedule = await this.campaignScheduleRepository.findOne({ where: { id } });
    if (!schedule) throw new Error('Schedule not found');
    return schedule;
  }

  async remove(id: string): Promise<void> {
    await this.campaignScheduleRepository.delete(id);
  }
}
