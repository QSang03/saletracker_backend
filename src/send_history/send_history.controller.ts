import { Controller, Get, Query, UseGuards, Req, HttpException, HttpStatus } from '@nestjs/common';
import { SendHistoryService } from './send_history.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { QuerySendHistoryDto } from './dto/query-send-history.dto';
import { Request } from 'express';

@Controller('send-history')
export class SendHistoryController {
  constructor(private readonly service: SendHistoryService) {}

  @UseGuards(AuthGuard)
  @Get()
  async findAll(@Query() q: QuerySendHistoryDto, @Req() req: Request) {
    try {
      console.log('Send history query params:', q);
      
      // If user provided no user_id, default to current user for non-admins could be added here
      const user = (req as any).user;

      const filter: any = {
        zalo_customer_id: q.zalo_customer_id,
        user_id: q.user_id,
        send_function: q.send_function,
        from: q.from,
        to: q.to,
        page: q.page,
        pageSize: q.pageSize,
        notes: q.notes,
      };

      console.log('Processed filter:', filter);

      // Optionally, if user is not admin you may want to default user_id to the current user
      // but leaving it as-is so admin can query across users

      const result = await this.service.query(filter);
      console.log('Send history result:', { total: result.total, count: result.data.length });
      return result;
    } catch (error) {
      console.error('Error in send history controller:', error);
      throw new HttpException(
        `Error fetching send history: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
