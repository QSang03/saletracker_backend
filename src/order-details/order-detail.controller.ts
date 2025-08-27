import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  Req,
  NotFoundException,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OrderDetailService } from './order-detail.service';
import { OrderDetail } from './order-detail.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderBlacklistService } from '../order-blacklist/order-blacklist.service';

@Controller('order-details')
@UseGuards(AuthGuard('jwt'))
export class OrderDetailController {
  constructor(
    private readonly orderDetailService: OrderDetailService,
    private readonly orderBlacklistService: OrderBlacklistService,
  ) {}

  @Get()
  async findAll(@Req() req?: any): Promise<OrderDetail[]> {
    return this.orderDetailService.findAllWithPermission(req.user);
  }

  @Get('trashed')
  async findAllTrashed(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '10',
    @Query('search') search?: string,
    @Query('employees') employees?: string,
    @Query('departments') departments?: string,
    @Query('products') products?: string,
    @Query('sortField') sortField?: 'quantity' | 'unit_price',
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
    @Req() req?: any,
  ): Promise<{
    data: OrderDetail[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.max(
      1,
      Math.min(parseInt(pageSize, 10) || 10, 10000),
    );

    return this.orderDetailService.findAllTrashedPaginated(req.user, {
      page: pageNum,
      pageSize: pageSizeNum,
      search: search?.trim(),
      employees,
      departments,
      products,
      sortField: sortField || null,
      sortDirection: sortDirection || null,
    });
  }

  @Post('bulk-restore')
  async bulkRestore(
    @Body() data: { ids: number[] },
    @Req() req?: any,
  ): Promise<{ restored: number }> {
    return this.orderDetailService.bulkRestore(data.ids, req.user);
  }

  // =============== Hidden (Ẩn) endpoints ===============
  @Get('hidden')
  async findAllHidden(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '10',
    @Query('search') search?: string,
    @Query('employees') employees?: string, // ✅ CSV của employee IDs
    @Query('departments') departments?: string, // ✅ CSV của department IDs
    @Query('status') status?: string, // ✅ CSV của statuses
    @Query('hiddenDateRange') hiddenDateRange?: string, // ✅ JSON string cho date range
    @Query('sortField') sortField?: 'quantity' | 'unit_price' | 'hidden_at',
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
    @Req() req?: any,
  ): Promise<{
    data: OrderDetail[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.max(
      1,
      Math.min(parseInt(pageSize, 10) || 10, 10000),
    );

    // ✅ Parse hiddenDateRange nếu có
    let parsedHiddenDateRange;
    if (hiddenDateRange) {
      try {
        parsedHiddenDateRange = JSON.parse(hiddenDateRange);
      } catch {
        parsedHiddenDateRange = undefined;
      }
    }

    return this.orderDetailService.findAllHiddenPaginated(req.user, {
      page: pageNum,
      pageSize: pageSizeNum,
      search: search?.trim(),
      employees,
      departments,
      status,
      hiddenDateRange: parsedHiddenDateRange,
      sortField: sortField || null,
      sortDirection: sortDirection || null,
    });
  }

  @Post('hidden/bulk-unhide')
  async bulkUnhide(
    @Body() data: { ids: number[] },
    @Req() req?: any,
  ): Promise<{ unhidden: number }> {
    return this.orderDetailService.bulkUnhide(data.ids, req.user);
  }

  @Post('hidden/bulk-hide')
  async bulkHide(
    @Body() data: { ids: number[]; reason: string },
    @Req() req?: any,
  ): Promise<{ hidden: number }> {
    return this.orderDetailService.bulkHide(data.ids, data.reason, req.user);
  }

  @Post(':id/unhide')
  async unhideOrderDetail(
    @Param('id', ParseIntPipe) id: number,
    @Req() req?: any,
  ): Promise<{ message: string }> {
    const result = await this.orderDetailService.unhide(id, req.user);
    if (!result) {
      throw new NotFoundException('Order detail not found or not owned by you');
    }
    return { message: 'Order detail unhidden successfully' };
  }

  // =============== Stats detailed endpoint ===============
  @Get('stats/detailed')
  async getDetailedStats(
    @Query('period') period: string = 'day',
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('status') status?: string,
    @Query('employees') employees?: string,
    @Query('departments') departments?: string,
    @Query('products') products?: string,
    @Req() req?: any,
  ): Promise<any> {
    return this.orderDetailService.getDetailedStats({
      period,
      date,
      dateFrom,
      dateTo,
      status,
      employees,
      departments,
      products,
      user: req.user,
    });
  }

  @Get('customer-count')
  @UseGuards(AuthGuard('jwt'))
  async getCustomerCount(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  @Query('employeeId') employeeId?: string,
  @Query('departmentId') departmentId?: string,
  // Apply full order filters
  @Query('search') search?: string,
  @Query('status') status?: string,
  @Query('date') date?: string,
  @Query('dateRange') dateRange?: string,
  @Query('employee') employee?: string,
  @Query('employees') employees?: string,
  @Query('departments') departments?: string,
  @Query('products') products?: string,
  @Query('warningLevel') warningLevel?: string,
  @Query('quantity') quantity?: string,
    @Req() req?: any,
  ) {
    // Parse và validate employeeId
    let parsedEmployeeId: number | undefined;
    if (employeeId && employeeId.trim() !== '') {
      const parsed = parseInt(employeeId);
      if (!isNaN(parsed)) {
        parsedEmployeeId = parsed;
      }
    }

    // Parse và validate departmentId
    let parsedDepartmentId: number | undefined;
    if (departmentId && departmentId.trim() !== '') {
      const parsed = parseInt(departmentId);
      if (!isNaN(parsed)) {
        parsedDepartmentId = parsed;
      }
    }

    // Parse dateRange if provided
    let parsedDateRange: any = undefined;
    if (dateRange) {
      try {
        parsedDateRange = JSON.parse(dateRange);
      } catch {
        parsedDateRange = undefined;
      }
    }

    const count = await this.orderDetailService.getCustomerCount({
      fromDate,
      toDate,
      date,
      dateRange: parsedDateRange,
      search: search?.trim(),
      status,
      employee,
      employees,
      departments,
      products,
      warningLevel,
      quantity,
      employeeId: parsedEmployeeId,
      departmentId: parsedDepartmentId,
      user: req?.user,
    });
    
    return { customerCount: count };
  }

  @Get('customers')
  @UseGuards(AuthGuard('jwt'))
  async getCustomers(
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  @Query('employeeId') employeeId?: string,
  @Query('departmentId') departmentId?: string,
  // Apply full order filters
  @Query('search') search?: string,
  @Query('status') status?: string,
  @Query('date') date?: string,
  @Query('dateRange') dateRange?: string,
  @Query('employee') employee?: string,
  @Query('employees') employees?: string,
  @Query('departments') departments?: string,
  @Query('products') products?: string,
  @Query('warningLevel') warningLevel?: string,
  @Query('quantity') quantity?: string,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '30',
    @Req() req?: any,
  ) {
    let parsedEmployeeId: number | undefined;
    if (employeeId && employeeId.trim() !== '') {
      const parsed = parseInt(employeeId);
      if (!isNaN(parsed)) parsedEmployeeId = parsed;
    }

    let parsedDepartmentId: number | undefined;
    if (departmentId && departmentId.trim() !== '') {
      const parsed = parseInt(departmentId);
      if (!isNaN(parsed)) parsedDepartmentId = parsed;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.max(1, Math.min(parseInt(pageSize, 10) || 30, 200));

    // Parse dateRange if provided
    let parsedDateRange: any = undefined;
    if (dateRange) {
      try {
        parsedDateRange = JSON.parse(dateRange);
      } catch {
        parsedDateRange = undefined;
      }
    }

    return this.orderDetailService.getDistinctCustomers({
      fromDate,
      toDate,
      date,
      dateRange: parsedDateRange,
      search: search?.trim(),
      status,
      employee,
      employees,
      departments,
      products,
      warningLevel,
      quantity,
      employeeId: parsedEmployeeId,
      departmentId: parsedDepartmentId,
      page: pageNum,
      pageSize: pageSizeNum,
      user: req?.user,
    });
  }

  @Get(':id')
  async findById(
    @Param('id', ParseIntPipe) id: number,
    @Req() req?: any,
  ): Promise<OrderDetail | null> {
    return this.orderDetailService.findByIdWithPermission(id, req.user);
  }

  @Get('order/:orderId')
  async findByOrderId(
    @Param('orderId', ParseIntPipe) orderId: number,
  ): Promise<OrderDetail[]> {
    return this.orderDetailService.findByOrderId(orderId);
  }

  @Post()
  async create(
    @Body() orderDetailData: Partial<OrderDetail>,
  ): Promise<OrderDetail> {
    return this.orderDetailService.create(orderDetailData);
  }

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() orderDetailData: Partial<OrderDetail>,
    @Req() req?: any,
  ): Promise<OrderDetail | null> {
    // Chỉ chủ sở hữu mới được sửa
    const existing = await this.orderDetailService.findById(id);
    if (!existing) throw new NotFoundException('Order detail not found');
    if (existing.order?.sale_by?.id !== req.user?.id) {
      throw new ForbiddenException('Bạn không có quyền sửa order này');
    }

  return this.orderDetailService.update(id, orderDetailData, req?.user);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string } = {},
    @Req() req?: any,
  ): Promise<void> {
    // Chỉ chủ sở hữu mới được xóa
    const existing = await this.orderDetailService.findById(id);
    if (!existing) throw new NotFoundException('Order detail not found');
    if (existing.order?.sale_by?.id !== req.user?.id) {
      throw new ForbiddenException('Bạn không có quyền xóa order này');
    }

    return this.orderDetailService.delete(id, body.reason);
  }

  @Delete('order/:orderId')
  async deleteByOrderId(
    @Param('orderId', ParseIntPipe) orderId: number,
  ): Promise<void> {
    return this.orderDetailService.deleteByOrderId(orderId);
  }

  // ✅ Bulk operations
  @Post('bulk-delete')
  async bulkDelete(
    @Body() data: { ids: number[]; reason: string },
    @Req() req?: any,
  ): Promise<{ deleted: number }> {
    return this.orderDetailService.bulkDelete(data.ids, data.reason, req.user);
  }

  @Post('bulk-update')
  async bulkUpdate(
    @Body() data: { ids: number[]; updates: Partial<OrderDetail> },
    @Req() req?: any,
  ): Promise<{ updated: number }> {
    return this.orderDetailService.bulkUpdate(data.ids, data.updates, req.user);
  }

  @Post('bulk-extend')
  async bulkExtend(
    @Body() data: { ids: number[] },
    @Req() req?: any,
  ): Promise<{ updated: number }> {
    return this.orderDetailService.bulkExtend(data.ids, req.user);
  }

  @Post('bulk-notes')
  async bulkAddNotes(
    @Body() data: { ids: number[]; notes: string },
    @Req() req?: any,
  ): Promise<{ updated: number }> {
    return this.orderDetailService.bulkAddNotes(data.ids, data.notes, req.user);
  }

  @Put(':id/customer-name')
  async updateCustomerName(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { customer_name: string },
    @Req() req?: any,
  ): Promise<OrderDetail | null> {
    // Chỉ chủ sở hữu mới được sửa tên khách hàng
    const existing = await this.orderDetailService.findById(id);
    if (!existing) throw new NotFoundException('Order detail not found');
    if (existing.order?.sale_by?.id !== req.user?.id) {
      throw new ForbiddenException('Bạn không có quyền sửa tên khách hàng');
    }

    return this.orderDetailService.updateCustomerName(
      id,
      data.customer_name,
      req.user,
    );
  }

  @Post(':id/add-to-blacklist')
  @HttpCode(HttpStatus.CREATED)
  async addToBlacklist(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { reason?: string },
    @Req() req?: any,
  ): Promise<{ message: string; blacklistEntry?: any }> {
    // Lấy order detail và kiểm tra quyền (chỉ chủ sở hữu được thêm blacklist)
    const orderDetail = await this.orderDetailService.findById(id);
    if (!orderDetail) {
      throw new NotFoundException('Order detail not found');
    }
    if (orderDetail.order?.sale_by?.id !== req.user?.id) {
      throw new ForbiddenException(
        'Bạn không có quyền thêm blacklist cho order này',
      );
    }

    // Parse customer_id từ metadata
    let customerId: string | null = null;
    try {
      if (typeof orderDetail.metadata === 'string') {
        const parsed = JSON.parse(orderDetail.metadata);
        customerId = parsed.customer_id || null;
      } else if (
        typeof orderDetail.metadata === 'object' &&
        orderDetail.metadata !== null
      ) {
        customerId = orderDetail.metadata.customer_id || null;
      }
    } catch (error) {
      // Ignore parse errors
    }

    if (!customerId) {
      throw new ForbiddenException(
        'No customer_id found in order detail metadata',
      );
    }

    // Kiểm tra xem đã có trong blacklist chưa
    const isAlreadyBlacklisted = await this.orderBlacklistService.isBlacklisted(
      req.user.id,
      customerId,
    );
    if (isAlreadyBlacklisted) {
      return { message: 'Contact is already in blacklist' };
    }

    // Thêm vào blacklist
    const blacklistEntry = await this.orderBlacklistService.create({
      userId: req.user.id,
      zaloContactId: customerId,
      reason: data.reason || `Added from order detail #${id}`,
    });

    return {
      message: 'Contact added to blacklist successfully',
      blacklistEntry,
    };
  }

}
