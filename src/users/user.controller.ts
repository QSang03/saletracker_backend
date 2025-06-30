import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  async findAll() {
    return this.userService.findAll();
  }

  @Post()
  async create(@Body() createUserDto: CreateUserDto) {
    return this.userService.createUser(createUserDto);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number, 
    @Body() updateUserDto: UpdateUserDto
  ) {
    return this.userService.updateUser(id, updateUserDto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.userService.softDeleteUser(id);
  }

  @Post(':userId/roles')
  async assignRoles(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() roleIds: number[],
  ) {
    return this.userService.assignRolesToUser(userId, roleIds);
  }

  @Get('for-permission-management')
  async getUsersForPermissionManagement() {
    const users = await this.userService.getUsersForPermissionManagement();
    return users.map(user => ({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      departments: (user.departments ?? []).map(d => ({ id: d.id, name: d.name })),
      roles: (user.roles ?? []).map(r => ({ id: r.id, name: r.name })),
    }));
  }
}
