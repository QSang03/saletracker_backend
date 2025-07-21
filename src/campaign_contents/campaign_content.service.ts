import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CampaignContent } from './campaign_content.entity';

@Injectable()
export class CampaignContentService {
  constructor(
    @InjectRepository(CampaignContent)
    private readonly campaignContentRepository: Repository<CampaignContent>,
  ) {}

  async getByCampaign(campaign_id: string): Promise<CampaignContent> {
    const content = await this.campaignContentRepository.findOne({ where: { campaign: { id: campaign_id } } });
    if (!content) throw new Error('Content not found');
    return content;
  }

  async create(data: Partial<CampaignContent>): Promise<CampaignContent> {
    const content = this.campaignContentRepository.create(data);
    return this.campaignContentRepository.save(content);
  }

  async update(id: string, data: Partial<CampaignContent>): Promise<CampaignContent> {
    await this.campaignContentRepository.update(id, data);
    return this.getById(id);
  }

  async getById(id: string): Promise<CampaignContent> {
    const content = await this.campaignContentRepository.findOne({ where: { id } });
    if (!content) throw new Error('Content not found');
    return content;
  }

  async remove(id: string): Promise<void> {
    await this.campaignContentRepository.delete(id);
  }
}
