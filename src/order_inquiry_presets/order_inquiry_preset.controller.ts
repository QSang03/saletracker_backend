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
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { OrderInquiryPresetService } from './order_inquiry_preset.service';
import { CreateOrderInquiryPresetDto } from './dto/create-order-inquiry-preset.dto';
import { UpdateOrderInquiryPresetDto } from './dto/update-order-inquiry-preset.dto';
import { FindOrderInquiryPresetDto } from './dto/find-order-inquiry-preset.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user: any;
}

@Controller('order-inquiry-presets')
@UseGuards(JwtAuthGuard)
export class OrderInquiryPresetController {
  constructor(
    private readonly orderInquiryPresetService: OrderInquiryPresetService,
  ) {}

  @Post()
  async create(
    @Body() createDto: CreateOrderInquiryPresetDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.orderInquiryPresetService.create(createDto, req.user);
  }

  @Get()
  async findAll(
    @Query() query: FindOrderInquiryPresetDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.orderInquiryPresetService.findAll(query, req.user);
  }

  @Get('my-presets')
  async findMyPresets(@Req() req: AuthenticatedRequest) {
    return await this.orderInquiryPresetService.findByUser(req.user.id);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.orderInquiryPresetService.findOne(id, req.user);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateOrderInquiryPresetDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return await this.orderInquiryPresetService.update(id, updateDto, req.user);
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.orderInquiryPresetService.remove(id, req.user);
    return { message: 'Preset đã được xóa thành công' };
  }
}
