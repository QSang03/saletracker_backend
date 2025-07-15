import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from './system_config.entity';
import { CreateSystemConfigDto } from './dto/create-system-config.dto';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';

@Injectable()
export class SystemConfigService {
  constructor(
    @InjectRepository(SystemConfig)
    private readonly configRepo: Repository<SystemConfig>,
  ) {}

  async getAll() {
    return this.configRepo.find();
  }

  async getByName(name: string) {
    const config = await this.configRepo.findOne({ where: { name } });
    if (!config) throw new NotFoundException('Config not found');
    return config;
  }

  async setConfig(name: string, value: string) {
    const config = await this.configRepo.findOne({ where: { name } });
    if (!config) throw new NotFoundException('Config not found');
    config.value = value;
    return this.configRepo.save(config);
  }

  async createConfig(data: CreateSystemConfigDto) {
    const config = this.configRepo.create(data);
    return this.configRepo.save(config);
  }

  async getBySectionAndName(section: string, name: string) {
    const config = await this.configRepo.findOne({ where: { section, name } });
    if (!config) throw new NotFoundException('Config not found');
    return config;
  }

  async updateBySectionAndName(
    section: string,
    name: string,
    value: string,
    status?: number,
  ) {
    const config = await this.configRepo.findOne({ where: { section, name } });
    if (!config) throw new NotFoundException('Config not found');
    config.value = value;
    if (typeof status !== 'undefined') {
      config.status = status;
    }
    return this.configRepo.save(config);
  }

  async updateConfigById(id: number, data: UpdateSystemConfigDto) {
    const config = await this.configRepo.findOne({ where: { id } });
    if (!config) throw new NotFoundException('Config not found');
    Object.assign(config, data);
    return this.configRepo.save(config);
  }

  async getBySection(section: string) {
    return this.configRepo.find({ where: { section } });
  }

  async getBySectionAndType(section: string, type: string) {
    return this.configRepo.find({ where: { section, type } });
  }
}
