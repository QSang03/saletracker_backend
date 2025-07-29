import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CampaignSchedule } from './campaign_schedule.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { User } from '../users/user.entity';

@Injectable()
export class CampaignScheduleService {
  constructor(
    @InjectRepository(CampaignSchedule)
    private readonly campaignScheduleRepository: Repository<CampaignSchedule>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
  ) {}

  async getByCampaign(campaignId: string, user: User): Promise<CampaignSchedule> {
    // Verify campaign exists and user has access
    const campaign = await this.campaignRepository.findOne({
      where: { id: campaignId },
      relations: ['department']
    });

    if (!campaign) {
      throw new NotFoundException('Không tìm thấy chiến dịch');
    }

    // Check department access
    const userDepartment = user.departments?.[0];
    if (userDepartment && campaign.department.id !== userDepartment.id) {
      throw new BadRequestException('Không có quyền truy cập chiến dịch này');
    }

    const schedule = await this.campaignScheduleRepository.findOne({ 
      where: { campaign: { id: campaignId } },
      relations: ['campaign']
    });

    if (!schedule) {
      throw new NotFoundException('Không tìm thấy lịch trình cho chiến dịch này');
    }

    return schedule;
  }

  async create(data: Partial<CampaignSchedule>, user: User): Promise<CampaignSchedule> {
    // Verify campaign exists and user has access if campaign is specified
    if (data.campaign?.id) {
      const campaign = await this.campaignRepository.findOne({
        where: { id: data.campaign.id },
        relations: ['department']
      });

      if (!campaign) {
        throw new NotFoundException('Không tìm thấy chiến dịch');
      }

      const userDepartment = user.departments?.[0];
      if (userDepartment && campaign.department.id !== userDepartment.id) {
        throw new BadRequestException('Không có quyền truy cập chiến dịch này');
      }

      // Check if schedule already exists for this campaign
      const existingSchedule = await this.campaignScheduleRepository.findOne({
        where: { campaign: { id: data.campaign.id } }
      });

      if (existingSchedule) {
        throw new BadRequestException('Chiến dịch này đã có lịch trình');
      }
    }

    const schedule = this.campaignScheduleRepository.create(data);
    return this.campaignScheduleRepository.save(schedule);
  }

  async update(id: string, data: Partial<CampaignSchedule>, user: User): Promise<CampaignSchedule> {
    const schedule = await this.getById(id, user);
    
    Object.assign(schedule, data);
    return this.campaignScheduleRepository.save(schedule);
  }

  async getById(id: string, user: User): Promise<CampaignSchedule> {
    const schedule = await this.campaignScheduleRepository.findOne({ 
      where: { id },
      relations: ['campaign', 'campaign.department']
    });

    if (!schedule) {
      throw new NotFoundException('Không tìm thấy lịch trình');
    }

    // Check department access
    const userDepartment = user.departments?.[0];
    if (userDepartment && schedule.campaign.department.id !== userDepartment.id) {
      throw new BadRequestException('Không có quyền truy cập lịch trình này');
    }

    return schedule;
  }

  async remove(id: string, user: User): Promise<void> {
    const schedule = await this.getById(id, user);
    await this.campaignScheduleRepository.remove(schedule);
  }
}
