import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { Request } from 'express';
import { AdminAuthGuard } from 'src/common/guards/admin-auth.guard';

@Controller('permissions')
@UseGuards(AuthGuard)
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @UseGuards(AdminAuthGuard)
  @Get()
  async findAll(@Req() req: Request) {
    const user = req.user;
    return this.permissionService.findAll(user);
  }
}
