import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Permission } from '../common/guards/permission.decorator';
import { CustomerAppointmentsService } from './customer-appointments.service';

export class AppointmentQueryDto {
  @IsString() from: string;
  @IsString() to: string;
  @IsOptional() @IsIn(['scheduled', 'checkin']) dateBy?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) saleId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) customerId?: number;
  @IsOptional()
  @IsIn([
    'pending',
    'approved',
    'checked_in',
    'completed',
    'rejected',
    'cancelled',
    'missed',
  ])
  status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

@Controller('customer-appointments')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CustomerAppointmentsController {
  constructor(private readonly appointments: CustomerAppointmentsService) {}

  @Get()
  @Permission('khach-hang', 'read')
  list(@Query() query: AppointmentQueryDto, @Req() req: any) {
    return this.appointments.list(query, req.user);
  }

  @Get('sync-status')
  @Permission('khach-hang', 'read')
  status() {
    return this.appointments.syncStatus();
  }

  @Post('sync')
  @Permission('khach-hang', 'import')
  sync() {
    return this.appointments.sync();
  }

  @Get(':id')
  @Permission('khach-hang', 'read')
  detail(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.appointments.detail(id, req.user);
  }

  @Get(':id/photos/:kind')
  @Permission('khach-hang', 'read')
  async photo(
    @Param('id', ParseIntPipe) id: number,
    @Param('kind') kind: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    const photo = await this.appointments.photo(id, kind, req.user);
    res.set({
      'Content-Type': photo.type,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(photo.bytes);
  }
}
