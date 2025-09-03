import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from 'src/users/user.service';
import { RedisService } from '../common/cache/redis.service';

interface AuthenticatedSocket extends Socket {
  user?: any;
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  port: 3001,
  // Performance optimizations
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8,
  allowEIO3: true,
  // Connection pooling
  connectTimeout: 45000,
  // Memory optimization
  perMessageDeflate: {
    threshold: 32768,
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    },
    zlibDeflateOptions: {
      level: 6
    }
  }
})
export class WebsocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private logger = new Logger('WebsocketGateway');
  private userSocketMap: Map<string, string> = new Map(); // userId <-> socketId
  private connectionPool: Map<string, { socket: AuthenticatedSocket; lastHeartbeat: number }> = new Map();
  private heartbeatInterval: NodeJS.Timeout;
  
  // Track users on campaign schedule page
  private campaignScheduleUsers: Map<string, { userId: string; userName: string; socketId: string; joinedAt: Date }> = new Map();
  
  // Track users currently editing (persistent until they explicitly stop)
  private editingUsers: Map<string, { userId: string; userName: string; socketId: string; cellId: string; startedAt: Date }> = new Map();

  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
    private readonly redisService: RedisService,
  ) {
    // Start heartbeat monitoring
    this.startHeartbeatMonitoring();
    console.log('[WebSocket] WebsocketGateway initialized with cell selections handlers');
    console.log('[WebSocket] Available handlers: schedule:cell:selections:update, schedule:cell:selections:clear, schedule:cell:selections:get, schedule:cell:selections:join, schedule:cell:selections:ping');
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      console.log('[WebSocket] New connection attempt from:', client.id);
      console.log('[WebSocket] Client handshake:', {
        headers: client.handshake.headers,
        auth: client.handshake.auth,
        address: client.handshake.address
      });
      

      
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers['authorization']?.split(' ')[1];
      if (!token) {
        console.log('[WebSocket] No token provided, disconnecting');
        client.disconnect();
        return;
      }
      
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_SECRET || 'your_default_secret',
      });
      client.user = payload;
      
      // Restore state from Redis if available
      await this.restoreUserStateFromRedis(payload.sub, client.id);
      
      this.userSocketMap.set(payload.sub, client.id);
      this.addToConnectionPool(client);
      console.log(`[WebSocket] User ${payload.sub} connected with socket ${client.id}`);
      

    } catch (err) {
      console.log('[WebSocket] Connection rejected: invalid token');
      client.disconnect();
    }
  }

  private async restoreUserStateFromRedis(userId: string, socketId: string) {
    try {
      // Restore campaign schedule users from Redis
      const campaignScheduleUsers = await this.redisService.getCampaignScheduleUsers();
      for (const user of campaignScheduleUsers) {
        if (user.userId === userId) {
          user.socketId = socketId;
          this.campaignScheduleUsers.set(userId, user);
          console.log(`[WebSocket] Restored campaign schedule user ${userId} from Redis`);
          break;
        }
      }

      // Restore editing users from Redis
      const editingUsers = await this.redisService.getEditingUsers();
      for (const user of editingUsers) {
        if (user.userId === userId) {
          user.socketId = socketId;
          this.editingUsers.set(userId, user);
          console.log(`[WebSocket] Restored editing user ${userId} from Redis`);
          break;
        }
      }
    } catch (error) {
      console.log('[WebSocket] Error restoring state from Redis:', error);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    if (client.user) {
      const userId = client.user.sub;
      this.userSocketMap.delete(userId);
      this.removeFromConnectionPool(client.id);
      
      // DON'T remove user from campaign schedule on disconnect
      // Only remove when they explicitly leave the page
      // This prevents losing users on temporary disconnections (reload, network issues)
      
      // DON'T remove user from editing users on disconnect either
      // Only remove when they explicitly stop editing
      // This prevents losing editing state on temporary disconnections
      
      // Keep users in both lists even when they disconnect
      // They will be restored when they reconnect
      
      this.logger.log(`User ${userId} disconnected`);
      this.logger.log(`Connection pool size: ${this.connectionPool.size}`);
      this.logger.log(`Users still in campaign schedule: ${this.campaignScheduleUsers.size}`);
      this.logger.log(`Users still editing: ${this.editingUsers.size}`);
      this.logger.log(`Users will be restored when they reconnect`);
    }
  }

  // Connection pooling methods
  private addToConnectionPool(client: AuthenticatedSocket) {
    this.connectionPool.set(client.id, {
      socket: client,
      lastHeartbeat: Date.now()
    });
  }

  private removeFromConnectionPool(clientId: string) {
    this.connectionPool.delete(clientId);
  }

  // Heartbeat monitoring
  private startHeartbeatMonitoring() {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeoutThreshold = 90000; // 90 seconds

      for (const [clientId, connection] of this.connectionPool.entries()) {
        if (now - connection.lastHeartbeat > timeoutThreshold) {
          this.logger.warn(`Client ${clientId} heartbeat timeout, disconnecting`);
          connection.socket.disconnect();
          this.removeFromConnectionPool(clientId);
        }
      }
    }, 30000); // Check every 30 seconds
  }

  private updateHeartbeat(clientId: string) {
    const connection = this.connectionPool.get(clientId);
    if (connection) {
      connection.lastHeartbeat = Date.now();
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

  // Test handler for cell selections
  @SubscribeMessage('test:cell:selections')
  handleTestCellSelections(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: any,
  ) {
    console.log('[TEST] Received test:cell:selections:', data);
    return { event: 'test:cell:selections:ack', data };
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() room: string,
  ) {
    client.join(room);
  }

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (client.user?.sub) {
      // Update heartbeat in connection pool
      this.updateHeartbeat(client.id);
      
      await this.userService.updateLastOnline(Number(client.user.sub));
      client.emit('heartbeat_ack', { 
        serverTime: Date.now(),
        connectionPoolSize: this.connectionPool.size
      });
    }
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

  // Campaign Schedule Presence Events
  @SubscribeMessage('campaign:schedule:join')
  async handleCampaignScheduleJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { userName: string },
  ) {
    if (!client.user?.sub) return;
    
    const userId = client.user.sub;
    const userInfo = {
      userId,
      userName: data.userName,
      socketId: client.id,
      joinedAt: new Date()
    };
    
    // Add user to campaign schedule users (both memory and Redis)
    this.campaignScheduleUsers.set(userId, userInfo);
    await this.redisService.setCampaignScheduleUser(userId, userInfo);
    
    console.log(`[WebSocket] User ${data.userName} joined campaign schedule page`);
    console.log(`[WebSocket] Total users on campaign schedule: ${this.campaignScheduleUsers.size}`);
    
    // Send current users list to the joining user
    const currentUsers = Array.from(this.campaignScheduleUsers.values())
      .filter(user => user.userId !== userId) // Exclude current user
      .map(user => ({
        userId: user.userId,
        userName: user.userName,
        joinedAt: user.joinedAt
      }));
    
    client.emit('campaign:schedule:current-users', currentUsers);
    
    // Notify other users about the new user
    this.server.emit('campaign:schedule:user-joined', {
      userId,
      userName: data.userName,
      joinedAt: userInfo.joinedAt
    });
  }

  @SubscribeMessage('campaign:schedule:leave')
  handleCampaignScheduleLeave(
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.user?.sub) return;
    
    const userId = client.user.sub;
    const userInfo = this.campaignScheduleUsers.get(userId);
    
    if (userInfo) {
      this.campaignScheduleUsers.delete(userId);
      console.log(`[WebSocket] User ${userInfo.userName} left campaign schedule page`);
      console.log(`[WebSocket] Total users on campaign schedule: ${this.campaignScheduleUsers.size}`);
      
      // Notify other users about the user leaving
      this.server.emit('campaign:schedule:user-left', {
        userId,
        userName: userInfo.userName
      });
    }
  }

  @SubscribeMessage('campaign:schedule:get-users')
  handleGetCampaignScheduleUsers(
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.user?.sub) return;
    
    const userId = client.user.sub;
    const currentUsers = Array.from(this.campaignScheduleUsers.values())
      .filter(user => user.userId !== userId) // Exclude current user
      .map(user => ({
        userId: user.userId,
        userName: user.userName,
        joinedAt: user.joinedAt
      }));
    
    client.emit('campaign:schedule:current-users', currentUsers);
  }

  @SubscribeMessage('schedule:get-editing-users')
  handleGetEditingUsers(
    @ConnectedSocket() client: AuthenticatedSocket,
  ) {
    if (!client.user?.sub) return;
    
    const userId = client.user.sub;
    const editingUsers = Array.from(this.editingUsers.values())
      .filter(user => user.userId !== userId) // Exclude current user
      .map(user => ({
        userId: user.userId,
        userName: user.userName,
        cellId: user.cellId,
        startedAt: user.startedAt
      }));
    
    client.emit('schedule:current-editing-users', editingUsers);
  }

  @SubscribeMessage('schedule:restore-editing-state')
  handleRestoreEditingState(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { cellId: string },
  ) {
    if (!client.user?.sub) return;
    
    const userId = client.user.sub;
    const userInfo = this.campaignScheduleUsers.get(userId);
    
    if (userInfo) {
      // Restore editing state for reconnected user
      this.editingUsers.set(userId, {
        userId,
        userName: userInfo.userName,
        socketId: client.id,
        cellId: data.cellId,
        startedAt: new Date() // Update start time for reconnection
      });
      
      console.log(`[WebSocket] User ${userInfo.userName} restored editing state for cell ${data.cellId}`);
      
      // Notify other users about the restored editing state
      this.server.emit('schedule:edit:start', {
        cellId: data.cellId,
        userId,
        userName: userInfo.userName
      });
    } else {
      // If user is not in campaign schedule, add them first
      console.log(`[WebSocket] User ${userId} not in campaign schedule, adding them first`);
      
      // Get user info from database or use default
      const userName = client.user?.name || client.user?.username || 'Unknown User';
      
      this.campaignScheduleUsers.set(userId, {
        userId,
        userName,
        socketId: client.id,
        joinedAt: new Date()
      });
      
      // Now restore editing state
      this.editingUsers.set(userId, {
        userId,
        userName,
        socketId: client.id,
        cellId: data.cellId,
        startedAt: new Date()
      });
      
      console.log(`[WebSocket] User ${userName} restored editing state for cell ${data.cellId}`);
      
      // Notify other users about the restored editing state
      this.server.emit('schedule:edit:start', {
        cellId: data.cellId,
        userId,
        userName
      });
    }
  }

  // Legacy schedule events (keep for compatibility)
  @SubscribeMessage('schedule:presence:update')
  handleSchedulePresenceUpdate(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: any,
  ) {
    console.log('[WebSocket] Received schedule:presence:update:', data);
    console.log('[WebSocket] User name being sent:', data.userName);
    console.log('[WebSocket] Broadcasting to all clients...');
    console.log('[WebSocket] Connected clients count:', this.server.sockets.sockets.size);
    
    // Broadcast presence update to all connected clients
    this.server.emit('schedule:presence:update', data);
    
    console.log('[WebSocket] Broadcast completed');
  }

  @SubscribeMessage('schedule:edit:start')
  async handleScheduleEditStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { cellId: string },
  ) {
    if (!client.user?.sub) return;
    
    const userId = client.user.sub;
    const userInfo = this.campaignScheduleUsers.get(userId);
    
    if (userInfo) {
      const editingUserData = {
        userId,
        userName: userInfo.userName,
        socketId: client.id,
        cellId: data.cellId,
        startedAt: new Date()
      };
      
      // Add to editing users (both memory and Redis)
      this.editingUsers.set(userId, editingUserData);
      await this.redisService.setEditingUser(userId, editingUserData);
      
      console.log(`[WebSocket] User ${userInfo.userName} started editing cell ${data.cellId}`);
      console.log(`[WebSocket] Total editing users: ${this.editingUsers.size}`);
    }
    
    // Broadcast edit start to all connected clients
    this.server.emit('schedule:edit:start', {
      ...data,
      userId,
      userName: userInfo?.userName
    });
  }

  @SubscribeMessage('schedule:edit:renew')
  handleScheduleEditRenew(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: any,
  ) {
    // Broadcast edit renew to all connected clients
    this.server.emit('schedule:edit:renew', data);
  }

  @SubscribeMessage('schedule:edit:stop')
  async handleScheduleEditStop(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { cellId: string },
  ) {
    if (!client.user?.sub) return;
    
    const userId = client.user.sub;
    const userInfo = this.campaignScheduleUsers.get(userId);
    
    // Remove from editing users (both memory and Redis)
    this.editingUsers.delete(userId);
    await this.redisService.removeEditingUser(userId);
    
    if (userInfo) {
      console.log(`[WebSocket] User ${userInfo.userName} stopped editing cell ${data.cellId}`);
      console.log(`[WebSocket] Total editing users: ${this.editingUsers.size}`);
    }
    
    // Broadcast edit stop to all connected clients
    this.server.emit('schedule:edit:stop', {
      ...data,
      userId,
      userName: userInfo?.userName
    });
  }

  @SubscribeMessage('schedule:preview:patch')
  handleSchedulePreviewPatch(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: any,
  ) {
    // Broadcast preview patch to all connected clients
    this.server.emit('schedule:preview:patch', data);
  }

  @SubscribeMessage('schedule:conflict:detected')
  handleScheduleConflictDetected(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: any,
  ) {
    // Broadcast conflict detection to all connected clients
    this.server.emit('schedule:conflict:detected', data);
  }

  @SubscribeMessage('schedule:version:update')
  handleScheduleVersionUpdate(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: any,
  ) {
    // Broadcast version update to all connected clients
    this.server.emit('schedule:version:update', data);
  }

  // Cell selection management
  @SubscribeMessage('schedule:cell:selections:update')
  async onUpdate(@MessageBody() { roomId, userId, selections }) {
    console.log('[SERVER] UPDATE received:', { roomId, userId });
    this.logger.log(`[REDIS] HSET room=${roomId} field=user:${userId}`);
    await this.redisService.setCellSelections(String(userId), selections, roomId);
    const after = await this.redisService.getAllCellSelections(roomId);
    this.logger.log(`[REDIS] HGETALL room=${roomId} -> ${after.length} fields`);
    this.server.to(roomId).emit('schedule:cell:selections:update', { roomId, userId, selections });
  }

  @SubscribeMessage('schedule:cell:selections:clear')
  async onClear(@MessageBody() { roomId, userId, reason, editingCells }) {
    console.log('[SERVER] CLEAR received:', { roomId, userId, reason, editingCells });
    if (!['explicit','leave','hidden','inactivity'].includes(reason)) return;
    this.logger.log(`[REDIS] HDEL room=${roomId} field=user:${userId} reason=${reason} cells=${editingCells?.length || 0}`);
    await this.redisService.removeCellSelections(String(userId), roomId);
    
    // Broadcast to ALL clients in the room, including the sender
    this.server.in(roomId).emit('schedule:cell:selections:clear', { roomId, userId, editingCells });
    
    // Also broadcast to all connected clients as fallback
    this.server.emit('schedule:cell:selections:clear', { roomId, userId, editingCells });
  }

  @SubscribeMessage('schedule:cell:selections:get')
  async onGet(@MessageBody() { roomId }, @ConnectedSocket() client: AuthenticatedSocket) {
    console.log('[SERVER] GET received:', { roomId });
    const entries = await this.redisService.getAllCellSelections(roomId);
    this.logger.log(`[REDIS] HGETALL room=${roomId} -> ${entries.length} fields`);
    client.emit('schedule:cell:selections:current', { roomId, entries });
  }

  @SubscribeMessage('schedule:cell:selections:join')
  async onJoin(@MessageBody() { roomId, userId }, @ConnectedSocket() client: AuthenticatedSocket) {
    console.log('[SERVER] JOIN received:', { roomId, userId });
    client.join(roomId); 
    client.data.roomId = roomId; 
    client.data.userId = userId;
    const entries = await this.redisService.getAllCellSelections(roomId);
    this.logger.log(`[REDIS] HGETALL room=${roomId} -> ${entries.length} fields`);
    client.emit('schedule:cell:selections:current', { roomId, entries });
  }

  @SubscribeMessage('schedule:cell:selections:ping')
  async handleScheduleCellSelectionsPing(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ) {
    if (!client.user?.sub) return;
    
    const userId = client.user.sub;
    
    // Refresh TTL for user's cell selections
    const roomId = data.roomId;
    const existingSelections = await this.redisService.getCellSelectionByUser(userId, roomId);
    if (existingSelections) {
      await this.redisService.setCellSelections(userId, existingSelections, roomId);
      console.log(`[WebSocket] Refreshed TTL for user ${userId} cell selections in room ${roomId}`);
    }
  }


  emitToUsers(userIds: string[], event: string, data: any) {
    userIds.forEach((userId) => this.emitToUser(userId, event, data));
  }

  emitToRoom(roomName: string, event: string, data: any) {
    this.server.to(roomName).emit(event, data);
  }

  // Cleanup method for graceful shutdown
  onModuleDestroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.logger.log('WebSocket Gateway shutdown complete');
  }
}
