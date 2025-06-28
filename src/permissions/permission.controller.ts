import { 
  Controller, 
  Get, 
  UseGuards,
  Req
} from "@nestjs/common";
import { PermissionService } from "./permission.service";
import { AuthGuard } from '../common/guards/auth.guard';
import { Request } from 'express';

@Controller('permissions')
@UseGuards(AuthGuard)
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get()
  async findAll(@Req() req: Request) {
    const token = req.headers.authorization?.split(' ')[1] || '';
    return this.permissionService.findAll(token);
  }
}
