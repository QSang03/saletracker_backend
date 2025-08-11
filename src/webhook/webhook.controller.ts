import { Controller, Post, Body, UseGuards, Put, Get, NotFoundException } from '@nestjs/common';
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
    console.log(
      `Webhook gọi: update-customer-name-by-customer-id với customer_id=${body.customer_id}, customer_name=${body.customer_name}`,
    );

    if (!body.customer_id || !body.customer_name) {
      return {
        success: false,
        message: 'Thiếu customer_id hoặc customer_name',
      };
    }
    const result = await this.orderDetailService.updateCustomerNameByCustomerId(
      body.customer_id,
      body.customer_name,
    );
    console.log(`Kết quả: ${JSON.stringify(result)}`);

    if (result.updated === 0) {
      console.log(
        `[Webhook] Không có order detail nào với customer_id=${body.customer_id}`,
      );
      // Trả về 404 Not Found
      throw new NotFoundException(
        'Không tìm thấy order detail với customer_id này',
      );
    }
    return {
      success: true,
      updated: result.updated,
      message: `Đã cập nhật ${result.updated} bản ghi`,
    };
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
