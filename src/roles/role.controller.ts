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
} from '@nestjs/common';
import { RoleService } from './role.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { Request } from 'express';

@Controller('roles')
@UseGuards(AuthGuard)
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  async findAll(@Req() req: Request) {
    const token = req.headers.authorization?.split(' ')[1] || '';
    return this.roleService.findAll(token);
  }

  @Get('grouped')
  async getGroupedRoles(@Req() req: Request) {
    const token = req.headers.authorization?.split(' ')[1] || '';
    return this.roleService.getGroupedRoles(token);
  }

  @Post()
  async create(@Body() createRoleDto: CreateRoleDto, @Req() req: Request) {
    const token = req.headers.authorization?.split(' ')[1] || '';
    return this.roleService.createRole(createRoleDto, token);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateRoleDto: UpdateRoleDto,
    @Req() req: Request,
  ) {
    const token = req.headers.authorization?.split(' ')[1] || '';
    return this.roleService.updateRole(+id, updateRoleDto, token);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const token = req.headers.authorization?.split(' ')[1] || '';
    return this.roleService.softDeleteRole(+id, token);
  }

  @Post(':roleId/permissions')
  async assignPermissions(
    @Param('roleId') roleId: string,
    @Body() permissionIds: number[],
    @Req() req: Request,
  ) {
    const token = req.headers.authorization?.split(' ')[1] || '';
    return this.roleService.assignPermissionsToRole(
      +roleId,
      permissionIds,
      token,
    );
  }
}
