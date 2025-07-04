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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, 
      Role,
      Department,
      ChangeUserLog,
    ]),
    JwtModule.register({}),
  ],
  providers: [UserService, UserGateway],
  controllers: [UserController],
  exports: [UserService, UserGateway],
})
export class UserModule {}
