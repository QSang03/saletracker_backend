import {
  BadRequestException,
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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Permission } from '../common/guards/permission.decorator';
import { CustomerAssignmentsService } from './customer-assignments.service';
import { ChangeDecisionDto, ImportSessionQueryDto } from './dto/import-session-query.dto';

/**
 * Nhóm API nạp danh sách khách hàng từ Excel.
 * Luồng: upload -> hệ thống so khớp -> người dùng chọn Giữ/Bỏ từng thay đổi
 * -> apply (có rollback). Không có API nào ghi thẳng dữ liệu.
 */
@Controller('customer-assignments')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CustomerAssignmentsController {
  constructor(
    private readonly assignmentsService: CustomerAssignmentsService,
  ) {}

  @Post('import')
  @Permission('khach-hang', 'import')
  @UseInterceptors(FileInterceptor('file'))
  import(@UploadedFile() file: any, @Req() req: any) {
    if (!file) throw new BadRequestException('Thiếu file Excel');
    return this.assignmentsService.createImport(file, req.user);
  }

  @Get('template')
  @Permission('khach-hang', 'read')
  async template(@Res() res: any) {
    const { buffer, fileName } = await this.assignmentsService.getTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @Delete('import-sessions/:id')
  @Permission('khach-hang', 'import')
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ) {
    return this.assignmentsService.cancelSession(id, req.user);
  }

  @Get('import-sessions')
  @Permission('khach-hang', 'read')
  sessions(@Query() query: ImportSessionQueryDto, @Req() req: any) {
    return this.assignmentsService.getSessions(query, req.user);
  }

  @Get('import-sessions/:id/preview')
  @Permission('khach-hang', 'read')
  preview(
    @Param('id', ParseIntPipe) id: number,
    @Query('action') action: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
  ) {
    return this.assignmentsService.getPreview(id, {
      action,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Patch('import-sessions/:id/changes/:changeId')
  @Permission('khach-hang', 'import')
  setDecision(
    @Param('id', ParseIntPipe) id: number,
    @Param('changeId', ParseIntPipe) changeId: number,
    @Body() dto: ChangeDecisionDto,
    @Req() req: any,
  ) {
    return this.assignmentsService.setChangeDecision(id, changeId, dto, req.user);
  }

  @Post('import-sessions/:id/apply')
  @HttpCode(HttpStatus.OK)
  @Permission('khach-hang', 'import')
  apply(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.assignmentsService.applySession(id, req.user);
  }

  @Post('import-sessions/:id/rollback')
  @HttpCode(HttpStatus.OK)
  @Permission('khach-hang', 'import')
  rollback(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.assignmentsService.rollbackSession(id, req.user);
  }
}
