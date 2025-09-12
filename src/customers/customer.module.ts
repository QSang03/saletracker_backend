import { Module, Controller, Get, Param } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerMessageHistory } from './customer_message_history.entity';

@Controller('customers')
class CustomersController {
  constructor(
    @InjectRepository(CustomerMessageHistory)
    private readonly historyRepo: Repository<CustomerMessageHistory>,
  ) {}

  @Get(':id/message-history')
  async getMessageHistory(@Param('id') id: string) {
    const rows = await this.historyRepo.find({
      where: { customerId: id },
      order: { created_at: 'DESC' },
      take: 100,
    });
    return rows.map((r) => ({
      id: Number(r.id),
      customer_id: Number(r.customerId),
      message: r.content,
      created_at: r.created_at,
      sent_at: r.sentAt,
    }));
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([CustomerMessageHistory])],
  controllers: [CustomersController],
})
export class CustomersModule {}
