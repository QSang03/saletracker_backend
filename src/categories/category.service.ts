import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './category.entity';

@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
  ) {}

  findAll() {
    return this.categoryRepository.find({
      relations: ['parent', 'children', 'products'],
    });
  }

  findOne(id: number) {
    return this.categoryRepository.findOne({
      where: { id },
      relations: ['parent', 'children', 'products'],
    });
  }

  create(data: Partial<Category>) {
    return this.categoryRepository.save(data);
  }

  update(id: number, data: Partial<Category>) {
    return this.categoryRepository.update(id, data);
  }

  remove(id: number) {
    return this.categoryRepository.delete(id);
  }
}
