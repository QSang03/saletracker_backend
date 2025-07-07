import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { CronjobService } from '../cronjobs/cronjob.service';
import { NKCProduct } from '../nkc_products/nkc_product.entity';
import { Category } from '../categories/category.entity';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HttpModule,
    TypeOrmModule.forFeature([NKCProduct, Category]),
  ],
  providers: [CronjobService],
})
export class CronjobModule {}
