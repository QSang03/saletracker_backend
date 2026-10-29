import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OrderCareService } from './order-care.service';
import { OrderCareStatsService } from './order-care-stats.service';
import {
  CareHistoryQueryDto,
  CarePreviewDto,
  CareSendDto,
  CareStatsQueryDto,
} from './dto/order-care.dto';

@Controller('order-care')
@UseGuards(AuthGuard('jwt'))
export class OrderCareController {
  constructor(
    private readonly orderCareService: OrderCareService,
    private readonly orderCareStatsService: OrderCareStatsService,
  ) {}

  @Post('preview')
  async preview(@Body() dto: CarePreviewDto, @Req() req: any) {
    return this.orderCareService.preview(req.user, dto);
  }

  @Post('care')
  async care(@Body() dto: CareSendDto, @Req() req: any) {
    return this.orderCareService.care(req.user, dto);
  }

  @Get('stats/overview')
  async statsOverview(
    @Query() query: CareStatsQueryDto,
    @Req() req: any,
  ) {
    return this.orderCareStatsService.getOverview(req.user, query);
  }

  @Get('orders/:id/history')
  async orderHistory(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: CareHistoryQueryDto,
    @Req() req: any,
  ) {
    return this.orderCareService.getOrderHistory(req.user, id, query);
  }

  @Get('batches/:id')
  async batch(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    return this.orderCareService.getBatch(req.user, id);
  }
}
