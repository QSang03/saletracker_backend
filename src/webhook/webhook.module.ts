import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { UserModule } from '../users/user.module';

@Module({
  imports: [UserModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
