import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: true })
export class UserGateway {
  @WebSocketServer()
  server: Server;

  // Khi client gửi join, cho socket vào room riêng
  @SubscribeMessage('join')
  handleJoin(
    @MessageBody() data: { userId: number },
    @ConnectedSocket() client: Socket,
  ) {
    if (data.userId) {
      client.join(`user_${data.userId}`);
    }
  }

  // Handle join user room specifically
  @SubscribeMessage('join-user-room')
  handleJoinUserRoom(
    @MessageBody() userId: number,
    @ConnectedSocket() client: Socket,
  ) {
    if (userId) {
      client.join(`user_${userId}`);
    }
  }

  @SubscribeMessage('joinAdmin')
  handleJoinAdmin(@ConnectedSocket() client: Socket) {
    client.join('admin_dashboard');
  }

  // Hàm này để emit sự kiện cho user khi cần
  notifyUserBlocked(userId: number) {
    this.server.to(`user_${userId}`).emit('user_blocked');
  }
}
