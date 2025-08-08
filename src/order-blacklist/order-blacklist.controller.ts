import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Request,
  HttpStatus,
  HttpCode,
  ForbiddenException,
} from '@nestjs/common';
import { OrderBlacklistService } from './order-blacklist.service';
import {
  CreateOrderBlacklistDto,
  UpdateOrderBlacklistDto,
  FindOrderBlacklistDto,
} from './dto/order-blacklist.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface BulkAddResult {
  success: boolean;
  zaloContactId: string;
  data?: any;
  error?: string;
}

@Controller('order-blacklist')
@UseGuards(JwtAuthGuard)
export class OrderBlacklistController {
  constructor(private readonly orderBlacklistService: OrderBlacklistService) {}

  @Post()
  async create(
    @Body() createDto: CreateOrderBlacklistDto,
    @Request() req: any,
  ) {
    // ✅ Sửa logic kiểm tra role
    const userRoles = req.user.roles ? req.user.roles.map((r) => r.name) : [];
    const isUser =
      !userRoles.includes('admin') &&
      !userRoles.some((role) => role.includes('manager'));

    if (isUser) {
      createDto.userId = req.user.id;
    }

    return await this.orderBlacklistService.create(createDto);
  }

  @Get()
  async findAll(@Query() query: any, @Request() req: any) {
    const filters = {
      page: parseInt(query.page) || 1,
      pageSize: parseInt(query.pageSize) || 10,
      search: query.search || '',
      departments: query.departments
        ? query.departments.split(',').map(Number)
        : [], // ✅ Thêm
      users: query.users ? query.users.split(',').map(Number) : [], // ✅ Thêm
    };
    return await this.orderBlacklistService.findAllWithPermissions(
      req.user,
      filters,
    );
  }

  // ✅ Thêm endpoint để lấy departments cho filter
  @Get('filter-options/departments')
  async getDepartmentsForFilter(@Request() req: any) {
    return await this.orderBlacklistService.getDepartmentsForFilter(req.user);
  }

  // ✅ Thêm endpoint để lấy users cho filter
  @Get('filter-options/users')
  async getUsersForFilter(
    @Query('departments') departments: string,
    @Request() req: any,
  ) {
    const departmentIds = departments
      ? departments
          .split(',')
          .map(Number)
          .filter((id) => !isNaN(id))
      : [];
    return await this.orderBlacklistService.getUsersForFilter(
      req.user,
      departmentIds,
    );
  }

  @Get('my-blacklisted-contacts')
  async getMyBlacklistedContacts(@Request() req: any) {
    return await this.orderBlacklistService.getBlacklistedContactsForUser(
      req.user.id,
    );
  }

  @Get('check/:zaloContactId')
  async checkBlacklist(
    @Param('zaloContactId') zaloContactId: string,
    @Request() req: any,
  ) {
    const isBlacklisted = await this.orderBlacklistService.isBlacklisted(
      req.user.id,
      zaloContactId,
    );
    return { isBlacklisted };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    const blacklist = await this.orderBlacklistService.findOne(+id);

    // ✅ Sửa logic kiểm tra role
    const userRoles = req.user.roles ? req.user.roles.map((r) => r.name) : [];
    const isUser =
      !userRoles.includes('admin') &&
      !userRoles.some((role) => role.includes('manager'));

    if (isUser && blacklist.userId !== req.user.id) {
      throw new ForbiddenException('Unauthorized access to blacklist entry');
    }

    return blacklist;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateOrderBlacklistDto,
    @Request() req: any,
  ) {
    const blacklist = await this.orderBlacklistService.findOne(+id);

    // Nếu là user thường, chỉ được update blacklist của chính mình
    if (req.user.role === 'user' && blacklist.userId !== req.user.id) {
      throw new ForbiddenException('Unauthorized access to blacklist entry');
    }

    return await this.orderBlacklistService.update(+id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Request() req: any) {
    const blacklist = await this.orderBlacklistService.findOne(+id);

    // Nếu là user thường, chỉ được xóa blacklist của chính mình
    if (req.user.role === 'user' && blacklist.userId !== req.user.id) {
      throw new ForbiddenException('Unauthorized access to blacklist entry');
    }

    await this.orderBlacklistService.remove(+id);
  }

  @Post('bulk-add')
  @HttpCode(HttpStatus.CREATED)
  async bulkAdd(
    @Body() data: { zaloContactIds: string[]; reason?: string },
    @Request() req: any,
  ) {
    const results: BulkAddResult[] = [];

    for (const zaloContactId of data.zaloContactIds) {
      try {
        const blacklist = await this.orderBlacklistService.create({
          userId: req.user.id,
          zaloContactId,
          reason: data.reason,
        });
        results.push({ success: true, zaloContactId, data: blacklist });
      } catch (error: any) {
        results.push({ success: false, zaloContactId, error: error.message });
      }
    }

    return { results };
  }
}
