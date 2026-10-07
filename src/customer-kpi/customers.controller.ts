import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Permission } from '../common/guards/permission.decorator';
import { CustomersService } from './customers.service';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import {
  UpdateZaloLinkDto,
  CreateZaloLinkDto,
} from './dto/update-zalo-link.dto';
import {
  BulkUpdateCustomersDto,
  CreateCustomerDto,
  ZaloContactQueryDto,
} from './dto/create-customer.dto';

/**
 * Nhóm API danh sách khách hàng.
 *
 * QUAN TRỌNG: `:id` là ID DÒNG PHÂN CÔNG (customer_assignments.id), không phải
 * customers.id — vì tier Key/Non và phạm vi theo Sale đều nằm ở dòng phân công.
 * Route tĩnh (`unmatched`, `zalo-links`) khai báo trước `:id`.
 */
@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @Permission('khach-hang', 'read')
  findAll(@Query() query: CustomerQueryDto, @Req() req: any) {
    return this.customersService.findAll(query, req.user);
  }

  @Get('unmatched')
  @Permission('khach-hang', 'read')
  unmatched(@Query() query: CustomerQueryDto, @Req() req: any) {
    return this.customersService.getUnmatched(query, req.user);
  }

  @Get('zalo-contacts')
  @Permission('khach-hang', 'read')
  zaloContacts(@Query() query: ZaloContactQueryDto, @Req() req: any) {
    return this.customersService.zaloContacts(query, req.user);
  }

  @Post()
  @Permission('khach-hang', 'create')
  create(@Body() dto: CreateCustomerDto, @Req() req: any) {
    return this.customersService.createCustomer(dto, req.user);
  }

  @Post('bulk-update')
  @HttpCode(HttpStatus.OK) // là cập nhật, không phải tạo mới — trả 200 thay vì 201 mặc định
  @Permission('khach-hang', 'update')
  bulkUpdate(@Body() dto: BulkUpdateCustomersDto, @Req() req: any) {
    return this.customersService.bulkUpdate(dto, req.user);
  }

  @Delete(':id')
  @Permission('khach-hang', 'delete')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.customersService.removeCustomer(id, req.user);
  }

  @Get('zalo-links/:id')
  @Permission('khach-hang', 'read')
  getZaloLink(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.customersService.getZaloLink(id, req.user);
  }

  /** Gắn tay cặp khớp MỚI khi job không tìm ra — chỉ admin (Mục 3 cv 2). */
  @Post('zalo-links')
  @Permission('khach-hang', 'update')
  createZaloLink(@Body() dto: CreateZaloLinkDto, @Req() req: any) {
    return this.customersService.createZaloLink(dto, req.user);
  }

  @Patch('zalo-links/:id')
  @Permission('khach-hang', 'update')
  updateZaloLink(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateZaloLinkDto,
    @Req() req: any,
  ) {
    return this.customersService.updateZaloLink(id, dto, req.user);
  }

  @Get(':id')
  @Permission('khach-hang', 'read')
  findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.customersService.findOne(id, req.user);
  }

  @Patch(':id')
  @Permission('khach-hang', 'update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerDto,
    @Req() req: any,
  ) {
    return this.customersService.update(id, dto, req.user);
  }

  @Get(':id/zalo-accounts')
  @Permission('khach-hang', 'read')
  getZaloAccounts(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.customersService.getZaloAccounts(id, req.user);
  }

  @Get(':id/response-daily')
  @Permission('khach-hang', 'read')
  getResponseDaily(
    @Param('id', ParseIntPipe) id: number,
    @Query('from') fromParam: string | undefined,
    @Query('to') toParam: string | undefined,
    @Req() req: any,
  ) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const fromStr = /^\d{4}-\d{2}-\d{2}$/.test(fromParam ?? '')
      ? (fromParam as string)
      : from.toISOString().slice(0, 10);
    const toStr = /^\d{4}-\d{2}-\d{2}$/.test(toParam ?? '')
      ? (toParam as string)
      : to.toISOString().slice(0, 10);
    return this.customersService.getResponseDaily(id, fromStr, toStr, req.user);
  }
}
