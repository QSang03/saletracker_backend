import { Controller, Post, Body, UseGuards, Put, Get } from '@nestjs/common';
import { UserService } from '../users/user.service';
import { UpdateZaloStatusDto } from '../users/dto/update-zalo-status.dto';
import { WebhookAuthGuard } from '../common/guards/webhook-auth.guard';
import { OrderDetailService } from 'src/order-details/order-detail.service';

@Controller('webhook')
@UseGuards(WebhookAuthGuard)
export class WebhookController {
  constructor(
    private readonly userService: UserService,
    private readonly orderDetailService: OrderDetailService,
  ) {}

  @Put('zalo-link-status')
  async updateZaloLinkStatus(@Body() updateZaloStatusDto: UpdateZaloStatusDto) {
    const { userId } = updateZaloStatusDto;

    try {
      const result = await this.userService.updateZaloLinkStatus(userId, 2);
      return {
        success: true,
        message: 'Zalo link status updated successfully',
        data: {
          userId: result?.id,
          zaloLinkStatus: result?.zaloLinkStatus,
          updatedAt: result?.updatedAt,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to update zalo link status',
        error: error.message,
      };
    }
  }

  @Post('update-customer-name-by-customer-id')
  async updateCustomerNameByCustomerId(
    @Body() body: { customer_id: string; customer_name: string },
  ) {
    if (!body.customer_id || !body.customer_name) {
      return { success: false, message: 'customer_id and customer_name are required' };
    }
    const result = await this.orderDetailService.updateCustomerNameByCustomerId(
      body.customer_id,
      body.customer_name,
    );
    return { success: true, updated: result.updated };
  }

  @Get('check-auth')
  async checkAuth() {
    try {
      const currentTime = new Date().toISOString();
      return {
        success: true,
        message: 'Thành công',
        data: {
          timestamp: currentTime,
          server: 'NKC-AutoZalo-V2',
          status: 'Thành công',
        },
      };
    } catch (error) {
      return {
        success: false,
        message: 'Thất bại',
        error: error.message,
      };
    }
  }
}
