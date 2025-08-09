import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { UserModule } from '../users/user.module';
import { OrderDetailModule } from 'src/order-details/order-detail.module';

@Module({
  imports: [UserModule, OrderDetailModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
