import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutoReplySalesPersona } from '../auto_reply_sales_personas/auto_reply_sales_persona.entity';
import { AutoReplyContact } from '../auto_reply_contacts/auto_reply_contact.entity';
import { AutoReplyCustomerProfile } from '../auto_reply_customer_profiles/auto_reply_customer_profile.entity';
import { AutoReplyProduct } from '../auto_reply_products/auto_reply_product.entity';
import { AutoReplyProductPriceTier } from '../auto_reply_products/auto_reply_product_price_tier.entity';
import { AutoReplyContactAllowedProduct } from '../auto_reply_contact_allowed_products/auto_reply_contact_allowed_product.entity';
import { AutoReplyKeywordRoute } from '../auto_reply_keyword_routes/auto_reply_keyword_route.entity';
import { AutoReplyRouteProduct } from '../auto_reply_products/auto_reply_route_product.entity';
import { AutoReplyConversation } from '../auto_reply_conversations/auto_reply_conversation.entity';
import { AutoReplyMessage } from '../auto_reply_messages/auto_reply_message.entity';
import { AutoReplyService } from './auto_reply.service';
import { AutoReplyController } from './auto_reply.controller';
import { WebsocketModule } from '../websocket/websocket.module';
import { UserModule } from '../users/user.module';
import { WebhookModule } from '../webhook/webhook.module';
import { AuthModule } from '../auth/auth.module';
import { NKCProduct } from '../nkc_products/nkc_product.entity';
import { User } from '../users/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AutoReplySalesPersona,
      AutoReplyContact,
      AutoReplyCustomerProfile,
      AutoReplyProduct,
      AutoReplyProductPriceTier,
      AutoReplyContactAllowedProduct,
      AutoReplyKeywordRoute,
      AutoReplyRouteProduct,
      AutoReplyConversation,
      AutoReplyMessage,
      NKCProduct,
      User,
    ]),
    forwardRef(() => WebsocketModule),
    forwardRef(() => UserModule),
  forwardRef(() => WebhookModule),
  // Ensure JwtService/AuthGuard are available in this module context
  forwardRef(() => AuthModule),
  ],
  controllers: [AutoReplyController],
  providers: [AutoReplyService],
  exports: [AutoReplyService],
})
export class AutoReplyModule {}
