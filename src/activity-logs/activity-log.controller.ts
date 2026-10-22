import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  ParseIntPipe,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { ActivityLogService, ActivityLogContext } from './activity-log.service';
import {
  CreateActivityLogDto,
  CreateActivityLogBatchDto,
} from './dto/create-activity-log.dto';
import { QueryActivityLogDto } from './dto/query-activity-log.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';

@Controller('activity-logs')
export class ActivityLogController {
  constructor(private readonly service: ActivityLogService) {}

  /**
   * Ghi một sự kiện thao tác.
   * Ai cũng ghi được, nhưng user luôn lấy từ JWT — không nhận userId từ body.
   */
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateActivityLogDto, @Req() req: Request) {
    await this.service.create(dto, this.buildContext(req));
    return { success: true };
  }

  /**
   * Ghi nhiều sự kiện cùng lúc (frontend gom batch để giảm số request).
   */
  @UseGuards(JwtAuthGuard)
  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  async createMany(
    @Body() dto: CreateActivityLogBatchDto,
    @Req() req: Request,
  ) {
    const count = await this.service.createMany(
      dto?.items ?? [],
      this.buildContext(req),
    );
    return { success: true, count };
  }

  /**
   * Danh sách bản ghi — chỉ Admin.
   * Bộ lọc: user_id, menu_path, menu_group, action, entity_id, from, to, search.
   */
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @Get()
  async findAll(@Query() query: QueryActivityLogDto) {
    return this.service.query(query);
  }

  /**
   * Tổng hợp theo menu / loại thao tác / user — chỉ Admin.
   */
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @Get('stats')
  async stats(@Query() query: QueryActivityLogDto) {
    return this.service.stats(query);
  }

  /**
   * Danh sách user để chọn trong bộ lọc — chỉ Admin.
   */
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @Get('users')
  async listUsers(@Query('search') search?: string) {
    return this.service.listUsers(search);
  }

  /**
   * Chi tiết một bản ghi — chỉ Admin.
   */
  @UseGuards(JwtAuthGuard, AdminAuthGuard)
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  /**
   * Gom thông tin người ghi log + thông tin client.
   */
  private buildContext(req: Request): ActivityLogContext {
    const user = (req as any).user;

    return {
      userId: user?.id ?? null,
      username: user?.username ?? null,
      fullName: user?.fullName ?? null,
      ipAddress: this.extractIp(req),
      userAgent: req.headers?.['user-agent'] ?? null,
    };
  }

  private extractIp(req: Request): string | null {
    const forwarded = req.headers?.['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const ip = (
      raw?.split(',')[0] ||
      req.ip ||
      req.socket?.remoteAddress ||
      ''
    ).trim();
    return ip ? ip.slice(0, 45) : null;
  }
}
