import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Request } from 'express';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async getAll(@Req() req: Request) {
    // @ts-ignore
    return this.notificationService.findAllByUser(req.user.id);
  }

  @Patch(':id/read')
  async markAsRead(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    // @ts-ignore
    return this.notificationService.markAsRead(id, req.user.id);
  }

  @Patch('read-many')
  async markManyAsRead(@Body('ids') ids: number[], @Req() req: Request) {
    // @ts-ignore
    return this.notificationService.markManyAsRead(ids, req.user.id);
  }

  @Delete(':id')
  async deleteOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    // @ts-ignore
    return this.notificationService.delete(id, req.user.id);
  }

  @Delete()
  async deleteAll(@Req() req: Request) {
    // @ts-ignore
    return this.notificationService.deleteAll(req.user.id);
  }
}
