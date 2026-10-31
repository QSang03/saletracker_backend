import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SaleResponseService } from './sale-response.service';
import { BlacklistIntervalDto } from './dto/blacklist-interval.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';


@Controller('sale-response')
@UseGuards(JwtAuthGuard)
export class SaleResponseController {
  constructor(private readonly saleResponseService: SaleResponseService) {}

  /**
   * Phạm vi xem dữ liệu do service quyết định (admin / view / manager+analysis /
   * user+analysis). Client không tự chỉnh được: userIds luôn bị ghi đè ở đây.
   */
  private async scopeFromRequest(req: any) {
    return this.saleResponseService.resolveScope(req.user);
  }

  @Get('overview')
  async overview(@Query() query: any, @Request() req: any) {
    const { userIds } = await this.scopeFromRequest(req);
    return this.saleResponseService.overview({ ...query, userIds });
  }

  @Get('by-sale')
  async bySale(@Query() query: any, @Request() req: any) {
    const { userIds } = await this.scopeFromRequest(req);
    return this.saleResponseService.bySale({ ...query, userIds });
  }

  @Get('by-day')
  async byDay(@Query() query: any, @Request() req: any) {
    const { userIds } = await this.scopeFromRequest(req);
    return this.saleResponseService.byDay({ ...query, userIds });
  }

  @Get('work-activity')
  async workActivity(@Query() query: any, @Request() req: any) {
    const { userIds } = await this.scopeFromRequest(req);
    return this.saleResponseService.workActivity({ ...query, userIds });
  }

  @Get('intervals')
  async intervals(@Query() query: any, @Request() req: any) {
    const { userIds } = await this.scopeFromRequest(req);
    return this.saleResponseService.intervals({
      ...query,
      userId: query.userId ? Number(query.userId) : undefined,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
      userIds,
    });
  }

  @Get('statuses')
  statuses() {
    return this.saleResponseService.statuses();
  }

  /**
   * Tin nhắn của một khoảng chờ — bấm vào cột "Số tin nhắn" ở bảng chi tiết
   * để xem lại hội thoại trong khung giờ của khoảng. Phạm vi xem do service
   * tự kiểm tra từ req.user; tra interval ngoài phạm vi trả 404.
   */
  @Get('intervals/:id/messages')
  async intervalMessages(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: any,
    @Request() req: any,
  ) {
    return this.saleResponseService.intervalMessages(
      req.user,
      id,
      query.page ? Number(query.page) : 1,
      query.pageSize ? Number(query.pageSize) : 50,
    );
  }

  /**
   * Chặn khách khỏi thống kê thời gian phản hồi của sale.
   * Dùng chung bảng order_blacklist, không cần khách đã phát sinh đơn.
   */
  @Post('blacklist')
  @HttpCode(HttpStatus.CREATED)
  async blacklist(
    @Body() dto: BlacklistIntervalDto,
    @Request() req: any,
  ) {
    return this.saleResponseService.blacklistContact(req.user, dto);
  }
}