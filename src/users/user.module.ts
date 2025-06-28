import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { User } from './user.entity';
import { Role } from '../roles/role.entity';
import { Department } from '../departments/department.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, 
      Role,
      Department,
    ]),
    JwtModule.register({}),
  ],
  providers: [UserService],
  controllers: [UserController],
  exports: [UserService],
})
export class UserModule {}
