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
import { AnalysisBlockService } from './analysis-block.service';
import {
  CreateAnalysisBlockDto,
  CreateAnalysisBlockRequestDto,
  UpdateAnalysisBlockDto,
  FindAnalysisBlockDto,
} from './dto/analysis-block.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface BulkAddResult {
  success: boolean;
  zaloContactId: string;
  blockType: 'analysis' | 'reporting' | 'stats';
  data?: any;
  error?: string;
}

@Controller('analysis-block')
@UseGuards(JwtAuthGuard)
export class AnalysisBlockController {
  constructor(private readonly analysisBlockService: AnalysisBlockService) {}

  @Post()
  async create(
    @Body() createDto: CreateAnalysisBlockRequestDto,
    @Request() req: any,
  ) {
    // Chỉ admin mới được tạo analysis block
    const userRoles = req.user.roles ? req.user.roles.map((r) => r.name) : [];
    if (!userRoles.includes('admin')) {
      throw new ForbiddenException('Chỉ admin mới có quyền tạo analysis block');
    }

    // Convert request DTO to service DTO
    const serviceDto: CreateAnalysisBlockDto = {
      userId: req.user.id,
      zaloContactId: createDto.zaloContactId,
      reason: createDto.reason,
      blockType: createDto.blockType,
    };

    return await this.analysisBlockService.create(serviceDto);
  }

  @Get()
  async findAll(@Query() query: any, @Request() req: any) {
    // Chỉ admin mới được xem danh sách analysis blocks
    const userRoles = req.user.roles ? req.user.roles.map((r) => r.name) : [];
    if (!userRoles.includes('admin')) {
      throw new ForbiddenException('Chỉ admin mới có quyền xem danh sách analysis blocks');
    }

    const filters = {
      page: parseInt(query.page) || 1,
      pageSize: parseInt(query.pageSize) || 10,
      search: query.search || '',
      departments: query.departments
        ? query.departments.split(',').map(Number)
        : [],
      users: query.users ? query.users.split(',').map(Number) : [],
      blockType: query.blockType || undefined,
    };
    return await this.analysisBlockService.findAllWithPermissions(
      req.user,
      filters,
    );
  }

  // Endpoint để lấy departments cho filter
  @Get('filter-options/departments')
  async getDepartmentsForFilter(
    @Query('users') users: string,
    @Request() req: any,
  ) {
    const userIds = users
      ? users
          .split(',')
          .map((id) => Number(id))
          .filter((id) => !isNaN(id))
      : [];
    return await this.analysisBlockService.getDepartmentsForFilter(
      req.user,
      userIds,
    );
  }

  // Endpoint để lấy users cho filter
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
    return await this.analysisBlockService.getUsersForFilter(
      req.user,
      departmentIds,
    );
  }

  @Get('my-blocked-contacts')
  async getMyBlockedContacts(
    @Query('blockType') blockType: string,
    @Request() req: any,
  ) {
    // Chỉ admin mới được xem blocked contacts
    const userRoles = req.user.roles ? req.user.roles.map((r) => r.name) : [];
    if (!userRoles.includes('admin')) {
      throw new ForbiddenException('Chỉ admin mới có quyền xem blocked contacts');
    }

    return await this.analysisBlockService.getBlockedContactsForUser(
      req.user.id,
      blockType,
    );
  }

  @Get('check/:zaloContactId/:blockType')
  async checkBlock(
    @Param('zaloContactId') zaloContactId: string,
    @Param('blockType') blockType: string,
    @Request() req: any,
  ) {
    // Chỉ admin mới được check analysis block status
    const userRoles = req.user.roles ? req.user.roles.map((r) => r.name) : [];
    if (!userRoles.includes('admin')) {
      throw new ForbiddenException('Chỉ admin mới có quyền check analysis block status');
    }

    const isBlocked = await this.analysisBlockService.isBlocked(
      req.user.id,
      zaloContactId,
      blockType,
    );
    return { isBlocked };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: any) {
    // Chỉ admin mới được xem chi tiết analysis block
    const userRoles = req.user.roles ? req.user.roles.map((r) => r.name) : [];
    if (!userRoles.includes('admin')) {
      throw new ForbiddenException('Chỉ admin mới có quyền xem chi tiết analysis block');
    }

    const analysisBlock = await this.analysisBlockService.findOne(+id);
    return analysisBlock;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateAnalysisBlockDto,
    @Request() req: any,
  ) {
    // Chỉ admin mới được cập nhật analysis block
    const userRoles = req.user.roles ? req.user.roles.map((r) => r.name) : [];
    if (!userRoles.includes('admin')) {
      throw new ForbiddenException('Chỉ admin mới có quyền cập nhật analysis block');
    }

    return await this.analysisBlockService.update(+id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Request() req: any) {
    // Chỉ admin mới được xóa analysis block
    const userRoles = req.user.roles ? req.user.roles.map((r) => r.name) : [];
    if (!userRoles.includes('admin')) {
      throw new ForbiddenException('Chỉ admin mới có quyền xóa analysis block');
    }

    await this.analysisBlockService.remove(+id);
  }

  @Post('bulk-add')
  @HttpCode(HttpStatus.CREATED)
  async bulkAdd(
    @Body() data: { 
      zaloContactIds: string[]; 
      reason?: string;
      blockType: 'analysis' | 'reporting' | 'stats';
    },
    @Request() req: any,
  ) {
    // Chỉ admin mới được bulk add analysis blocks
    const userRoles = req.user.roles ? req.user.roles.map((r) => r.name) : [];
    if (!userRoles.includes('admin')) {
      throw new ForbiddenException('Chỉ admin mới có quyền bulk add analysis blocks');
    }

    const results: BulkAddResult[] = [];

    for (const zaloContactId of data.zaloContactIds) {
      try {
        const analysisBlock = await this.analysisBlockService.create({
          userId: req.user.id,
          zaloContactId,
          reason: data.reason,
          blockType: data.blockType,
        });
        results.push({ 
          success: true, 
          zaloContactId, 
          blockType: data.blockType,
          data: analysisBlock 
        });
      } catch (error: any) {
        results.push({ 
          success: false, 
          zaloContactId, 
          blockType: data.blockType,
          error: error.message 
        });
      }
    }

    return { results };
  }
}
