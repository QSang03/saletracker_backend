import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CampaignCustomer } from './campaign_customer.entity';

@Injectable()
export class CampaignCustomerService {
  constructor(
    @InjectRepository(CampaignCustomer)
    private readonly campaignCustomerRepository: Repository<CampaignCustomer>,
  ) {}

  async findAll(query: any): Promise<CampaignCustomer[]> {
    // Thêm logic filter nếu cần
    return this.campaignCustomerRepository.find();
  }

  async findOne(id: string): Promise<CampaignCustomer> {
    const customer = await this.campaignCustomerRepository.findOne({ where: { id } });
    if (!customer) throw new Error('Customer not found');
    return customer;
  }

  async create(data: Partial<CampaignCustomer>): Promise<CampaignCustomer> {
    const customer = this.campaignCustomerRepository.create(data);
    return this.campaignCustomerRepository.save(customer);
  }

  async update(id: string, data: Partial<CampaignCustomer>): Promise<CampaignCustomer> {
    await this.campaignCustomerRepository.update(id, data);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.campaignCustomerRepository.delete(id);
  }
}
