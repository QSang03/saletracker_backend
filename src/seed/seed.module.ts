import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeedService } from './seed.service';
import { Permission } from '../permissions/permission.entity';
import { Role } from '../roles/role.entity';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';
import { RolePermission } from '../roles_permissions/roles-permissions.entity';
import { SystemConfig } from '../system_config/system_config.entity';
import { DatabaseChangeLog } from 'src/observers/change_log.entity';
import { SeedDebtTriggerService } from './seed-debt-trigger.service';
import { SeedCampaignTriggerService } from './seed-campaign-trigger.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Permission,
      Role,
      User,
      Department,
      RolePermission,
      SystemConfig,
      DatabaseChangeLog,
    ]),
  ],
  providers: [SeedService, SeedDebtTriggerService, SeedCampaignTriggerService],
})
export class SeedModule {}
