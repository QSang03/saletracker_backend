import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Brand } from './brand.entity';
import { BrandService } from '../brands/brand.service';
import { BrandController } from '../brands/brand.controller';
import { BrandSubscriber } from './brand.subscriber';
import { PermissionModule } from '../permissions/permission.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Brand]), PermissionModule, AuthModule],
  providers: [BrandService, BrandSubscriber],
  controllers: [BrandController],
  exports: [BrandService],
})
export class BrandModule {}
