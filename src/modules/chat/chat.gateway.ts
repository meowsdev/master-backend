import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Namespace, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';

export class ConversationRoomDto {
  @IsUUID()
  conversationId!: string;
}

export class MessageHistoryDto extends ConversationRoomDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @IsOptional()
  @IsInt()
  @Min(0)
  offset = 0;
}

// Connect to /chat with handshake.auth.token set to an access JWT.
@WebSocketGateway({
  namespace: '/chat',
  maxHttpBufferSize: 64 * 1024,
  cors: {
    origin: true,
    credentials: true,
  },
})
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: () => new WsException('Invalid chat payload'),
  }),
)
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Namespace;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  afterInit(server: Namespace) {
    this.logger.log('Chat WebSocket Gateway initialized');
    server.use((client, next) => {
      void this.authenticate(client).then(
        () => next(),
        (err) => {
          this.logger.warn(`WebSocket handshake rejected: ${err.message}`);
          next(new Error('Unauthorized'));
        },
      );
    });
  }

  handleConnection(client: Socket) {
    const userId = client.data?.userId || 'unknown';
    this.logger.log(`Socket client connected: ${client.id} (user: ${userId})`);
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId || 'unknown';
    this.logger.log(`Socket client disconnected: ${client.id} (user: ${userId})`);
  }

  private async authenticate(client: Socket): Promise<string> {
    if (client.data?.userId) {
      return client.data.userId;
    }

    const auth = (client.handshake.auth || {}) as { token?: unknown };
    const query = (client.handshake.query || {}) as { token?: unknown };
    const headers = client.handshake.headers || {};

    const supplied =
      auth.token ?? query.token ?? headers.authorization ?? headers.token;

    if (typeof supplied !== 'string' || !supplied.trim()) {
      throw new WsException('Unauthorized: No access token supplied');
    }

    const token = supplied.replace(/^Bearer\s+/i, '').trim();
    const secret =
      this.config.get<string>('JWT_SECRET') ||
      process.env.JWT_SECRET ||
      'secret';

    if (!token || !secret) {
      throw new WsException('Unauthorized: Invalid token configuration');
    }

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub?: string;
        exp?: number;
      }>(token, { secret, algorithms: ['HS256'] });

      if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
        throw new Error('Invalid access token payload');
      }

      try {
        const isBlacklisted = await this.redis.exists(
          `auth:blacklist:access:${token}`,
        );
        if (isBlacklisted) {
          throw new Error('Revoked access token');
        }
      } catch (redisErr) {
        // Continue if redis check fails gracefully
        this.logger.debug(`Redis check skipped: ${redisErr}`);
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, status: true, role: true, name: true },
      });

      if (!user || user.status !== 'ACTIVE') {
        throw new Error('Inactive or non-existent user');
      }

      client.data.user = user;
      client.data.userId = user.id;

      return user.id;
    } catch (err: any) {
      this.logger.warn(`JWT verification failed for socket: ${err.message}`);
      throw new WsException('Unauthorized');
    }
  }

  private async authorize(client: Socket, conversationId: string) {
    const userId = await this.authenticate(client);
    const userRole = client.data?.user?.role;

    const isStaffOrCounselor =
      userRole === 'COUNSELOR' ||
      userRole === 'ADMIN' ||
      userRole === 'MANAGER' ||
      userRole === 'SUPPORT';

    const conversation = await this.prisma.chatSession.findFirst({
      where: isStaffOrCounselor
        ? { id: conversationId }
        : {
            id: conversationId,
            OR: [
              { customerId: userId },
              { customerUser: { id: userId } },
              { customerProfile: { userId } },
              { counselorId: userId },
              { providerId: userId },
              { participants: { some: { userId, isActive: true } } },
            ],
          },
      select: { id: true, counselorId: true },
    });

    if (!conversation) {
      throw new WsException('Conversation access denied');
    }

    if (!conversation.counselorId && userRole === 'COUNSELOR') {
      await this.prisma.chatSession
        .update({
          where: { id: conversationId },
          data: { counselorId: userId, assignedAt: new Date() },
        })
        .catch(() => {});
    }

    await this.prisma.chatParticipant
      .upsert({
        where: {
          sessionId_userId: {
            sessionId: conversationId,
            userId,
          },
        },
        update: {
          isActive: true,
          leftAt: null,
        },
        create: {
          sessionId: conversationId,
          userId,
          isActive: true,
        },
      })
      .catch(() => {});

    return userId;
  }

  private room(conversationId: string) {
    return `conversation:${conversationId}`;
  }

  @SubscribeMessage('joinConversation')
  async joinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ConversationRoomDto,
  ) {
    await this.authorize(client, dto.conversationId);
    await client.join(this.room(dto.conversationId));
    await client.join(dto.conversationId);
    this.logger.log(
      `Socket ${client.id} joined room conversation:${dto.conversationId}`,
    );
    return { success: true, conversationId: dto.conversationId };
  }

  @SubscribeMessage('leaveConversation')
  async leaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ConversationRoomDto,
  ) {
    const userId = await this.authorize(client, dto.conversationId);
    await this.chatService.leaveConversation(dto.conversationId, userId);
    await client.leave(this.room(dto.conversationId));
    await client.leave(dto.conversationId);
    return { success: true, conversationId: dto.conversationId };
  }

  @SubscribeMessage('leaveRoom')
  async leaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ConversationRoomDto,
  ) {
    await client.leave(this.room(dto.conversationId));
    await client.leave(dto.conversationId);
    return { success: true, conversationId: dto.conversationId };
  }

  @SubscribeMessage('sendMessage')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SendMessageDto,
  ) {
    const conversationId = dto.conversationId || dto.sessionId;
    if (!conversationId) {
      throw new WsException('conversationId is required');
    }
    const senderId = await this.authorize(client, conversationId);
    if (!dto.text?.trim() && !dto.fileUrl?.trim()) {
      throw new WsException('Message text or file URL is required');
    }
    const message = await this.chatService.saveMessage(senderId, {
      ...dto,
      conversationId,
    });
    this.publishMessage(message);
    return message;
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ConversationRoomDto,
  ) {
    const userId = await this.authorize(client, dto.conversationId);
    const userName = client.data?.user?.name || 'Someone';
    client.to(this.room(dto.conversationId)).emit('userTyping', {
      conversationId: dto.conversationId,
      userId,
      userName,
    });
  }

  @SubscribeMessage('stopTyping')
  async handleStopTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ConversationRoomDto,
  ) {
    const userId = await this.authorize(client, dto.conversationId);
    client.to(this.room(dto.conversationId)).emit('userStoppedTyping', {
      conversationId: dto.conversationId,
      userId,
    });
  }

  publishMessage(message: Awaited<ReturnType<ChatService['saveMessage']>>) {
    if (!message?.sessionId) return;
    const room = this.room(message.sessionId);
    if (this.server) {
      try {
        this.server.to(room).emit('newMessage', message);
        this.server.to(message.sessionId).emit('newMessage', message);
        this.server.emit('conversationUpdated', {
          sessionId: message.sessionId,
          message,
        });
        this.logger.log(`Broadcasted newMessage to room ${room}`);
      } catch (err: any) {
        this.logger.warn(`Failed to broadcast message: ${err.message}`);
      }
    }
  }

  @SubscribeMessage('getMessages')
  async getMessages(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: MessageHistoryDto,
  ) {
    await this.authorize(client, dto.conversationId);
    return this.chatService.getMessages(
      dto.conversationId,
      dto.limit ?? 50,
      dto.offset ?? 0,
    );
  }
}

