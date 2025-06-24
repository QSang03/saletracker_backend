import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserRole } from './user-role.entity';
import { UserRolesService } from './user-roles.service';
import { UserRolesController } from './user-roles.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserRole])],
  providers: [UserRolesService],
  controllers: [UserRolesController],
})
export class UserRolesModule {}