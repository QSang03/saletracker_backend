import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { SaleResponseService } from './sale-response.service';
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
}