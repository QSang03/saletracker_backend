import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NKCProduct } from './nkc_product.entity';

@Injectable()
export class NKCProductService {
  constructor(
    @InjectRepository(NKCProduct)
    private readonly nkcProductRepository: Repository<NKCProduct>,
  ) {}

  findAll() {
    return this.nkcProductRepository.find();
  }

  findOne(id: number) {
    return this.nkcProductRepository.findOne({ where: { id } });
  }

  create(data: Partial<NKCProduct>) {
    return this.nkcProductRepository.save(data);
  }

  update(id: number, data: Partial<NKCProduct>) {
    return this.nkcProductRepository.update(id, data);
  }

  remove(id: number) {
    return this.nkcProductRepository.delete(id);
  }
}
