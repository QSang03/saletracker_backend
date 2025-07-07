import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NKCProduct } from './nkc_product.entity';
import { NKCProductService } from '../nkc_products/nkc_product.service';
import { NKCProductController } from '../nkc_products/nkc_product.controller';

@Module({
  imports: [TypeOrmModule.forFeature([NKCProduct])],
  providers: [NKCProductService],
  controllers: [NKCProductController],
  exports: [NKCProductService],
})
export class NKCProductModule {}
