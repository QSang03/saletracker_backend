import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
import { Campaign, CampaignStatus, CampaignType } from './campaign.entity';
import { User } from '../users/user.entity';

@Injectable()
export class CampaignService {
  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
  ) {}

  async findAll(query: any = {}, user: User): Promise<{ 
    data: Campaign[]; 
    total: number; 
    stats: {
      totalCampaigns: number;
      draftCampaigns: number;
      runningCampaigns: number;
      completedCampaigns: number;
    }
  }> {
    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.created_by', 'created_by')
      .leftJoinAndSelect('campaign.department', 'department');

    // Filter by search (campaign name)
    if (query.search) {
      qb.andWhere('campaign.name LIKE :search', { 
        search: `%${query.search}%` 
      });
    }

    // Filter by campaign types
    if (query.campaignTypes && Array.isArray(query.campaignTypes)) {
      qb.andWhere('campaign.campaign_type IN (:...campaignTypes)', {
        campaignTypes: query.campaignTypes
      });
    }

    // Filter by status
    if (query.statuses && Array.isArray(query.statuses)) {
      qb.andWhere('campaign.status IN (:...statuses)', {
        statuses: query.statuses
      });
    }

    // Filter by creators (sales people)
    if (query.createdBy && Array.isArray(query.createdBy)) {
      qb.andWhere('campaign.created_by IN (:...createdBy)', {
        createdBy: query.createdBy
      });
    }

    // Pagination
    const page = Math.max(1, parseInt(query.page) || 1);
    const pageSize = Math.max(1, parseInt(query.pageSize) || 10);
    const skip = (page - 1) * pageSize;

    qb.skip(skip).take(pageSize);
    qb.orderBy('campaign.created_at', 'DESC');

    const [data, total] = await qb.getManyAndCount();
    
    // Get stats
    const stats = await this.getStats(user);
    
    return { data, total, stats };
  }

  async findOne(id: string, user: User): Promise<Campaign> {
    const campaign = await this.campaignRepository.findOne({
      where: { id },
      relations: ['created_by', 'department']
    });
    
    if (!campaign) {
      throw new NotFoundException('Không tìm thấy chiến dịch');
    }
    
    return campaign;
  }

  async create(data: Partial<Campaign>, user: User): Promise<Campaign> {
    const userDepartment = user.departments?.[0]; // Lấy department đầu tiên
    
    const campaign = this.campaignRepository.create({
      ...data,
      created_by: user,
      department: userDepartment,
      status: CampaignStatus.DRAFT
    });
    
    return this.campaignRepository.save(campaign);
  }

  async update(id: string, data: Partial<Campaign>, user: User): Promise<Campaign> {
    const campaign = await this.findOne(id, user);
    
    Object.assign(campaign, data);
    return this.campaignRepository.save(campaign);
  }

  async updateStatus(id: string, status: CampaignStatus, user: User): Promise<Campaign> {
    const campaign = await this.findOne(id, user);
    
    // Validate status transitions
    this.validateStatusTransition(campaign.status, status);
    
    campaign.status = status;
    return this.campaignRepository.save(campaign);
  }

  async delete(id: string, user: User): Promise<void> {
    const campaign = await this.findOne(id, user);
    
    if (campaign.status === CampaignStatus.RUNNING) {
      throw new BadRequestException('Không thể xóa chiến dịch đang chạy');
    }
    
    await this.campaignRepository.remove(campaign);
  }

  async archive(id: string, user: User): Promise<Campaign> {
    return this.updateStatus(id, CampaignStatus.ARCHIVED, user);
  }

  private validateStatusTransition(currentStatus: CampaignStatus, newStatus: CampaignStatus): void {
    const validTransitions: Record<CampaignStatus, CampaignStatus[]> = {
      [CampaignStatus.DRAFT]: [CampaignStatus.SCHEDULED],
      [CampaignStatus.SCHEDULED]: [CampaignStatus.RUNNING, CampaignStatus.DRAFT],
      [CampaignStatus.RUNNING]: [CampaignStatus.PAUSED, CampaignStatus.COMPLETED],
      [CampaignStatus.PAUSED]: [CampaignStatus.RUNNING, CampaignStatus.COMPLETED],
      [CampaignStatus.COMPLETED]: [CampaignStatus.ARCHIVED],
      [CampaignStatus.ARCHIVED]: []
    };

    if (!validTransitions[currentStatus]?.includes(newStatus)) {
      throw new BadRequestException(
        `Không thể chuyển từ trạng thái ${currentStatus} sang ${newStatus}`
      );
    }
  }

  async getStats(user: User): Promise<any> {
    const qb = this.campaignRepository.createQueryBuilder('campaign');
    
    const userDepartment = user.departments?.[0];
    if (userDepartment) {
      qb.where('campaign.department = :departmentId', { 
        departmentId: userDepartment.id 
      });
    }

    const [
      totalCampaigns,
      draftCampaigns,
      runningCampaigns,
      completedCampaigns
    ] = await Promise.all([
      qb.getCount(),
      qb.clone().andWhere('campaign.status = :status', { status: CampaignStatus.DRAFT }).getCount(),
      qb.clone().andWhere('campaign.status = :status', { status: CampaignStatus.RUNNING }).getCount(),
      qb.clone().andWhere('campaign.status = :status', { status: CampaignStatus.COMPLETED }).getCount()
    ]);

    return {
      totalCampaigns,
      draftCampaigns,
      runningCampaigns,
      completedCampaigns
    };
  }
}
