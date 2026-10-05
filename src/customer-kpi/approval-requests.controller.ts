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
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Permission } from '../common/guards/permission.decorator';
import { ApprovalRequestsService } from './approval-requests.service';
import { ApprovalRequestQueryDto, DecideApprovalDto } from './dto/approval-request.dto';

/**
 * Hàng chờ duyệt dùng chung: sửa danh sách khách hàng (nhân viên -> trưởng
 * phòng) và giao chỉ tiêu (trưởng phòng -> admin). Ai được duyệt gì kiểm tra
 * ở service theo request_type và vai trò.
 */
@Controller('approval-requests')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ApprovalRequestsController {
  constructor(private readonly approvalsService: ApprovalRequestsService) {}

  @Get()
  @Permission('khach-hang', 'read')
  list(@Query() query: ApprovalRequestQueryDto, @Req() req: any) {
    return this.approvalsService.list(query, req.user);
  }

  @Get(':id')
  @Permission('khach-hang', 'read')
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.approvalsService.getDetail(id);
  }

  @Post(':id/decide')
  @HttpCode(HttpStatus.OK)
  @Permission('khach-hang', 'approve')
  decide(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideApprovalDto,
    @Req() req: any,
  ) {
    return this.approvalsService.decide(id, dto, req.user);
  }
}
