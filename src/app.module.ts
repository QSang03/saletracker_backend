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
import { ConfigModule } from '@nestjs/config'; // Thêm ConfigModule

@Module({
  imports: [
    ConfigModule.forRoot({ // Thêm cấu hình này
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
