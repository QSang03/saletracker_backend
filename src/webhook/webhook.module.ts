import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { UserModule } from '../users/user.module';
import { OrderDetailModule } from 'src/order-details/order-detail.module';
import { WebhookService } from './webhook.service';

@Module({
  imports: [UserModule, OrderDetailModule],
  controllers: [WebhookController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
