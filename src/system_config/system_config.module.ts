import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemConfig } from './system_config.entity';
import { SystemConfigService } from './system_config.service';
import { SystemConfigController } from './system_config.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([SystemConfig]), AuthModule],
  providers: [SystemConfigService],
  controllers: [SystemConfigController],
  exports: [SystemConfigService],
})
export class SystemConfigModule {}