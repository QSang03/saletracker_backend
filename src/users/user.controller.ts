import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
  Put,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('users')
@UseGuards(AuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll() {
    return this.userService.findAll();
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Body() createUserDto: CreateUserDto) {
    return this.userService.createUser(createUserDto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.updateUser(+id, updateUserDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string) {
    return this.userService.softDeleteUser(+id);
  }

  @Post(':userId/roles')
  @UseGuards(JwtAuthGuard)
  async assignRoles(
    @Param('userId') userId: string,
    @Body() roleIds: number[],
  ) {
    return this.userService.assignRolesToUser(+userId, roleIds);
  }

  @Get('for-permission-management')
  @UseGuards(JwtAuthGuard)
  async getUsersForPermissionManagement() {
    return this.userService.getUsersForPermissionManagement();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findOne(id);
  }
}
