import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutoGreetingCustomer } from './auto_greeting_customer.entity';
import { AutoGreetingCustomerMessageHistory } from './auto_greeting_customer_message_history.entity';
import { SystemConfig } from '../system_config/system_config.entity';
import { User } from '../users/user.entity';
import { AutoGreetingService } from './auto_greeting.service';
import { AutoGreetingController } from './auto_greeting.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AutoGreetingCustomer,
      AutoGreetingCustomerMessageHistory,
      SystemConfig,
      User,
    ]),
    AuthModule,
  ],
  providers: [
    AutoGreetingService,
  ],
  controllers: [
    AutoGreetingController,
  ],
  exports: [
    AutoGreetingService,
  ],
})
export class AutoGreetingModule {}
