import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { User } from './user.entity';
import { Role } from '../roles/role.entity';
import { Permission } from '../permissions/permission.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, 
      Role,
      Permission
    ]),
    JwtModule.register({}),
  ],
  providers: [UserService],
  controllers: [UserController],
  exports: [UserService],
})
export class UserModule {}
