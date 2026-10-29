import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OrderDetailService } from '../order-details/order-detail.service';
import { BulkSetProjectDto, SetProjectDto } from './dto/order-care.dto';

@Controller('order-projects')
@UseGuards(AuthGuard('jwt'))
export class OrderProjectController {
  constructor(private readonly orderDetailService: OrderDetailService) {}

  @Patch(':id')
  async setProject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetProjectDto,
    @Req() req: any,
  ) {
    return this.orderDetailService.setProject(id, dto.is_project, req.user);
  }

  @Post('bulk')
  async bulkSetProject(@Body() dto: BulkSetProjectDto, @Req() req: any) {
    return this.orderDetailService.bulkSetProject(
      dto.ids,
      dto.is_project,
      req.user,
    );
  }
}
