import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './product.entity';

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  findAll() {
    return this.productRepository.find({ relations: ['categories', 'brand', 'nkcProduct'] });
  }

  findOne(id: number) {
    return this.productRepository.findOne({ where: { id }, relations: ['categories', 'brand', 'nkcProduct'] });
  }

  create(data: Partial<Product>) {
    return this.productRepository.save(data);
  }

  update(id: number, data: Partial<Product>) {
    return this.productRepository.update(id, data);
  }

  remove(id: number) {
    return this.productRepository.delete(id);
  }
}
