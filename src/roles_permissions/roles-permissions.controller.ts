import { Controller, Post, Body, UseGuards, Get } from '@nestjs/common';
import { RolesPermissionsService } from './roles-permissions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('roles-permissions')
@UseGuards(JwtAuthGuard)
export class RolesPermissionsController {
  constructor(private readonly service: RolesPermissionsService) {}

  @Post('bulk')
  async bulkUpdate(
    @Body()
    permissions: Array<{
      roleId: number;
      permissionId: number;
      isActive: boolean;
    }>,
  ) {
    return this.service.bulkUpdate(permissions);
  }

  @Get('all')
  async getAll() {
    return this.service.findAll();
  }
}
