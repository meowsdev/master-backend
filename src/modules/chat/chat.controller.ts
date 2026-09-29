import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { CreateChatSessionDto } from './dto/create-chatSession.dto';
import { SendMessageDto } from './dto/send-message.dto';

export class AddChatParticipantDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;
}

export class ChatHistoryQueryDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}

type AuthenticatedRequest = Request & { user: { id: string } };

@ApiTags('Chat')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly prisma: PrismaService,
    private readonly chatGateway: ChatGateway,
  ) {}

  @Post('conversations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get or create a conversation for your customer profile',
  })
  async getOrCreateConversation(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateChatSessionDto,
  ) {
    let customerProfile = await this.prisma.customerProfile.findUnique({
      where: { userId: req.user.id },
      select: { id: true },
    });
    if (!customerProfile) {
      customerProfile = await this.prisma.customerProfile.create({
        data: { userId: req.user.id },
        select: { id: true },
      });
    }

    let targetServiceId = dto.serviceId;
    const service = targetServiceId
      ? await this.prisma.service.findFirst({
          where: { id: targetServiceId, isActive: true, isDeleted: false },
          select: { id: true },
        })
      : null;

    if (!service) {
      const fallbackService = await this.prisma.service.findFirst({
        where: { isActive: true, isDeleted: false },
        select: { id: true },
      });
      if (!fallbackService) {
        throw new BadRequestException(
          'No active service found to create consultation',
        );
      }
      targetServiceId = fallbackService.id;
    }

    return this.chatService.getOrCreateConversation({
      serviceId: targetServiceId!,
      customerProfileId: customerProfile.id,
      providerId: dto.providerId,
    });
  }

  @Post('conversations/:conversationId/participants')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Conversation owner adds or reactivates a provider/counselor',
  })
  async addParticipant(
    @Req() req: AuthenticatedRequest,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Body() dto: AddChatParticipantDto,
  ) {
    const owned = await this.prisma.chatSession.findFirst({
      where: { id: conversationId, customerProfile: { userId: req.user.id } },
      select: {
        id: true,
        serviceId: true,
      },
    });
    if (!owned)
      throw new ForbiddenException(
        'Only the conversation owner can add participants',
      );

    const participant = await this.prisma.user.findFirst({
      where: {
        id: dto.userId,
        status: 'ACTIVE',
        role: { in: ['PROVIDER', 'COUNSELOR'] },
        serviceAssignments: {
          some: {
            serviceId: owned.serviceId,
            isActive: true,
          },
        },
      },
      select: { id: true },
    });
    if (!participant)
      throw new BadRequestException(
        'Provider or counselor is not assigned to this service',
      );
    return this.chatService.addParticipant(conversationId, dto.userId);
  }

  @Post('messages')
  @ApiOperation({
    summary: 'Save a message and notify connected conversation members',
  })
  async sendMessage(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SendMessageDto,
  ) {
    const conversationId = dto.conversationId || dto.sessionId;
    if (!conversationId) {
      throw new BadRequestException('conversationId is required');
    }
    await this.assertAccess(req.user.id, conversationId);
    if (!dto.text?.trim() && !dto.fileUrl?.trim()) {
      throw new BadRequestException('Message text or file URL is required');
    }
    const message = await this.chatService.saveMessage(req.user.id, {
      ...dto,
      conversationId,
    });
    this.chatGateway.publishMessage(message);
    return message;
  }

  @Get('conversations/:conversationId/messages')
  @ApiOperation({ summary: 'Read conversation messages, newest first' })
  async getMessages(
    @Req() req: AuthenticatedRequest,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
    @Query() query: ChatHistoryQueryDto,
  ) {
    await this.assertAccess(req.user.id, conversationId);
    return this.chatService.getMessages(
      conversationId,
      query.limit,
      query.offset,
    );
  }

  private async assertAccess(userId: string, conversationId: string) {
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
    if (!conversation) {
      throw new ForbiddenException('Conversation access denied');
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
  }

  @Patch('counselor/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle counselor online/offline status' })
  setCounselorStatus(
    @Req() req: AuthenticatedRequest,
    @Body('isOnline') isOnline: boolean,
  ) {
    return this.chatService.setCounselorOnlineStatus(req.user.id, isOnline);
  }
}
