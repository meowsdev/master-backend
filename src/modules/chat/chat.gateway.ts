import { UsePipes, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
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
@WebSocketGateway({ namespace: '/chat', maxHttpBufferSize: 64 * 1024 })
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: () => new WsException('Invalid chat payload'),
  }),
)
export class ChatGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  afterInit(server: Namespace) {
    server.use((client, next) => {
      void this.authenticate(client).then(
        () => next(),
        () => next(new Error('Unauthorized')),
      );
    });
  }

  private async authenticate(client: Socket): Promise<string> {
    const auth = client.handshake.auth as { token?: unknown };
    const supplied = auth.token ?? client.handshake.headers.authorization;
    if (typeof supplied !== 'string') throw new WsException('Unauthorized');

    const token = supplied.replace(/^Bearer\s+/i, '').trim();
    const secret = this.config.get<string>('JWT_SECRET');
    if (!token || !secret) throw new WsException('Unauthorized');

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub?: string;
        exp?: number;
      }>(token, { secret, algorithms: ['HS256'] });

      if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
        throw new Error('Invalid access token');
      }
      if (await this.redis.exists(`auth:blacklist:access:${token}`)) {
        throw new Error('Revoked access token');
      }
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, status: true },
      });
      if (!user || user.status !== 'ACTIVE') throw new Error('Inactive user');
      return user.id;
    } catch {
      throw new WsException('Unauthorized');
    }
  }

  private async authorize(client: Socket, conversationId: string) {
    const userId = await this.authenticate(client);
    const conversation = await this.prisma.chatSession.findFirst({
      where: {
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
      select: { id: true },
    });
    if (!conversation) throw new WsException('Conversation access denied');
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

  @SubscribeMessage('leaveRoom')
  async leaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ConversationRoomDto,
  ) {
    await client.leave(this.room(dto.conversationId));

    return {
      success: true,
      conversationId: dto.conversationId,
    };
  }

  publishMessage(message: Awaited<ReturnType<ChatService['saveMessage']>>) {
    const room = this.room(message.sessionId);
    if (this.server) {
      try {
        this.server.to(room).emit('newMessage', message);
      } catch {
        // Safe fallback if websocket emit encounters temporary transport error
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
