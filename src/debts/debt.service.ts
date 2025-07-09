import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Debt } from './debt.entity';

@Injectable()
export class DebtService {
  constructor(
    @InjectRepository(Debt)
    private readonly debtRepository: Repository<Debt>,
  ) {}

  findAll() {
    return this.debtRepository.find();
  }

  findOne(id: number) {
    return this.debtRepository.findOneBy({ id });
  }

  create(data: Partial<Debt>) {
    return this.debtRepository.save(data);
  }

  update(id: number, data: Partial<Debt>) {
    return this.debtRepository.update(id, data);
  }

  remove(id: number) {
    return this.debtRepository.softDelete(id);
  }
}
