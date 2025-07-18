import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UseGuards, Logger, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface AuthenticatedSocket extends Socket {
  user?: any;
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class WebsocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger = new Logger('WebsocketGateway');
  private userSocketMap: Map<string, string> = new Map(); // userId <-> socketId

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers['authorization']?.split(' ')[1];
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'your_default_secret',
      });
      client.user = payload;
      this.userSocketMap.set(payload.sub, client.id);
      this.logger.log(`User ${payload.sub} connected with socket ${client.id}`);
    } catch (err) {
      this.logger.warn('WebSocket connection rejected: invalid token');
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (client.user) {
      this.userSocketMap.delete(client.user.sub);
      this.logger.log(`User ${client.user.sub} disconnected`);
    }
  }

  // Example: listen to a test event
  @SubscribeMessage('ping')
  handlePing(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: any,
  ) {
    return { event: 'pong', data };
  }

  // Emit to a specific user
  emitToUser(userId: string, event: string, data: any) {
    const socketId = this.userSocketMap.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    }
  }

  // Emit to all users
  emitToAll(event: string, data: any) {
    this.server.emit(event, data);
  }

  // Emit to a group of users
  emitToUsers(userIds: string[], event: string, data: any) {
    userIds.forEach((userId) => this.emitToUser(userId, event, data));
  }
}
