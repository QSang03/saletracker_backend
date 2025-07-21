import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CampaignEmailReport } from './campaign_email_report.entity';

@Injectable()
export class CampaignEmailReportService {
  constructor(
    @InjectRepository(CampaignEmailReport)
    private readonly campaignEmailReportRepository: Repository<CampaignEmailReport>,
  ) {}

  async getByCampaign(campaign_id: string): Promise<CampaignEmailReport> {
    const report = await this.campaignEmailReportRepository.findOne({ where: { campaign: { id: campaign_id } } });
    if (!report) throw new Error('Report not found');
    return report;
  }

  async create(data: Partial<CampaignEmailReport>): Promise<CampaignEmailReport> {
    const report = this.campaignEmailReportRepository.create(data);
    return this.campaignEmailReportRepository.save(report);
  }

  async update(id: string, data: Partial<CampaignEmailReport>): Promise<CampaignEmailReport> {
    await this.campaignEmailReportRepository.update(id, data);
    return this.getById(id);
  }

  async getById(id: string): Promise<CampaignEmailReport> {
    const report = await this.campaignEmailReportRepository.findOne({ where: { id } });
    if (!report) throw new Error('Report not found');
    return report;
  }

  async remove(id: string): Promise<void> {
    await this.campaignEmailReportRepository.delete(id);
  }
}
