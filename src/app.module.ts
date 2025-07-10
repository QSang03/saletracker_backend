import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './users/user.module';
import { AuthModule } from './auth/auth.module';
import { RoleModule } from './roles/role.module';
import { PermissionModule } from './permissions/permission.module';
import { DepartmentModule } from './departments/department.module';
import { SeedModule } from './seed/seed.module';
import { typeOrmConfig } from './config/typeorm.config';
import { ConfigModule } from '@nestjs/config';
import { SystemConfigModule } from './system_config/system_config.module';
import { NKCProductModule } from './nkc_products/nkc_product.module';
import { ProductModule } from './products/product.module';
import { CategoryModule } from './categories/category.module';
import { BrandModule } from './brands/brand.module';
import { CronjobModule } from './cronjobs/cronjob.module';
import { DebtConfigsModule } from './debt_configs/debt_configs.module';
import { DebtModule } from './debts/debt.module';
import { DebtLogsModule } from './debt_logs/debt_logs.module';
import { DebtHistoriesModule } from './debt_histories/debt_histories.module';
import { RolesPermissionsModule } from './roles_permissions/roles-permissions.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env'
    }),
    TypeOrmModule.forRoot(typeOrmConfig),
    AuthModule,
    UserModule,
    RoleModule,
    PermissionModule,
    DepartmentModule,
    SeedModule,
    SystemConfigModule,
    NKCProductModule,
    ProductModule,
    CategoryModule,
    BrandModule,
    CronjobModule,
    DebtConfigsModule,
    DebtModule,
    DebtLogsModule,
    DebtHistoriesModule,
    RolesPermissionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
