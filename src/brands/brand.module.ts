import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Brand } from './brand.entity';
import { BrandService } from '../brands/brand.service';
import { BrandController } from '../brands/brand.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Brand])],
  providers: [BrandService],
  controllers: [BrandController],
  exports: [BrandService],
})
export class BrandModule {}
