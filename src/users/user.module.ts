import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { User } from './user.entity';
import { Role } from '../roles/role.entity';
import { Department } from '../departments/department.entity';
import { UserGateway } from './user.gateway';
import { ChangeUserLog } from './change-user-log.entity';
import { RolesPermissionsModule } from '../roles_permissions/roles-permissions.module';
import { UserStatusObserver } from '../observers/user-status.observer';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, 
      Role,
      Department,
      ChangeUserLog,
    ]),
    JwtModule.register({}),
    RolesPermissionsModule,
  ],
  providers: [UserService, UserGateway, UserStatusObserver],
  controllers: [UserController],
  exports: [UserService, UserGateway, UserStatusObserver],
})
export class UserModule {}
