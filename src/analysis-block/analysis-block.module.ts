import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalysisBlockService } from './analysis-block.service';
import { AnalysisBlockController } from './analysis-block.controller';
import { AnalysisBlock } from './analysis-block.entity';
import { OrderDetail } from '../order-details/order-detail.entity';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AnalysisBlock, OrderDetail, User, Department])],
  controllers: [AnalysisBlockController],
  providers: [AnalysisBlockService],
  exports: [AnalysisBlockService],
})
export class AnalysisBlockModule {}
