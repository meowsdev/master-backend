import { Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatSessionService } from './chat-session.service';

interface AuthenticatedRequest {
  user: { id: string };
}

@ApiTags('Chat')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('chat/orders')
export class OrderConversationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: ChatSessionService,
  ) {}

  /**
   * The provider (or assigned technician) opens the customer's chat for one of their orders.
   * The customer's per-service conversation is reused, and the provider joins it as a participant,
   * which is what the message endpoints check. Nobody else can join through this route.
   */
  @Get(':orderId/conversation')
  @ApiOperation({ summary: 'Conversation of an order, for the provider handling it' })
  async forProvider(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Req() req: AuthenticatedRequest) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        serviceId: true,
        customerId: true,
        provider: { select: { userId: true } },
        technician: { select: { userId: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const isHandlingOrder = order.provider.userId === req.user.id || order.technician?.userId === req.user.id;
    if (!isHandlingOrder) throw new ForbiddenException('Only the provider handling this order can open its chat');

    const session = await this.sessions.getOrCreateConversation({
      serviceId: order.serviceId,
      customerProfileId: order.customerId,
      providerId: order.provider.userId,
    });

    if (!session) throw new NotFoundException('Conversation not found');

    await this.prisma.chatParticipant.upsert({
      where: { sessionId_userId: { sessionId: session.id, userId: req.user.id } },
      update: { isActive: true, leftAt: null },
      create: { sessionId: session.id, userId: req.user.id },
    });
    return session;
  }
}
