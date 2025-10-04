import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderInquiryPresetService } from './order_inquiry_preset.service';
import { OrderInquiryPresetController } from './order_inquiry_preset.controller';
import { OrderInquiryPreset } from './order_inquiry_preset.entity';

@Module({
  imports: [TypeOrmModule.forFeature([OrderInquiryPreset])],
  controllers: [OrderInquiryPresetController],
  providers: [OrderInquiryPresetService],
  exports: [OrderInquiryPresetService],
})
export class OrderInquiryPresetModule {}
