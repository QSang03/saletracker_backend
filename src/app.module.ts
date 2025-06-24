import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { typeOrmConfig } from './config/typeorm.config';
import { RoleModule } from './role/role.module';
import { UserRolesModule } from './user-roles/user-roles.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(typeOrmConfig),
    UserModule,
    AuthModule,
    RoleModule,
    UserRolesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
  
})
export class AppModule {}
