import { Injectable, Logger } from '@nestjs/common';
import { WebsocketGateway } from '../websocket/websocket.gateway';

export interface RenameWebhookPayload {
  contactId?: number;
  zaloContactId?: string;
  newName: string;
  requestedByUserId?: number;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger('WebhookService');

  constructor(private readonly ws: WebsocketGateway) {}

  async queueRenameContact(payload: RenameWebhookPayload) {
    // In a real integration, push to a job queue or call external webhook here.
    this.logger.log(`Queue rename contact: ${JSON.stringify(payload)}`);

    // Realtime notify requestor if provided
    if (payload.requestedByUserId) {
      this.ws.emitToUser(String(payload.requestedByUserId), 'autoReply:renameQueued', {
        contactId: payload.contactId,
        zaloContactId: payload.zaloContactId,
        newName: payload.newName,
      });
    }
    return { queued: true };
  }
}
