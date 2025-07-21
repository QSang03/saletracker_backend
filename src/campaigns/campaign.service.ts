import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign } from './campaign.entity';

@Injectable()
export class CampaignService {
  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
  ) {}

  async findAll(query: any, user: any): Promise<Campaign[]> {
    // Thêm logic filter nếu cần
    return this.campaignRepository.find();
  }

  async findOne(id: string): Promise<Campaign> {
    const campaign = await this.campaignRepository.findOne({ where: { id } });
    if (!campaign) throw new Error('Campaign not found');
    return campaign;
  }

  async create(data: Partial<Campaign>, user: any): Promise<Campaign> {
    // Gán created_by nếu cần
    const campaign = this.campaignRepository.create({ ...data, created_by: user });
    return this.campaignRepository.save(campaign);
  }

  async update(id: string, data: Partial<Campaign>): Promise<Campaign> {
    await this.campaignRepository.update(id, data);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.campaignRepository.delete(id);
  }
}
