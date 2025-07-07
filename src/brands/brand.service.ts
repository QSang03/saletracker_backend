import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Brand } from './brand.entity';

@Injectable()
export class BrandService {
  constructor(
    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,
  ) {}

  findAll() {
    return this.brandRepository.find({ relations: ['products'] });
  }

  findOne(id: number) {
    return this.brandRepository.findOne({ where: { id }, relations: ['products'] });
  }

  create(data: Partial<Brand>) {
    return this.brandRepository.save(data);
  }

  update(id: number, data: Partial<Brand>) {
    return this.brandRepository.update(id, data);
  }

  remove(id: number) {
    return this.brandRepository.delete(id);
  }
}
