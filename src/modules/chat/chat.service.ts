import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageType, PaymentMode, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatBookingService } from './chat-booking.service';
import { ChatSessionService } from './chat-session.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingService: ChatBookingService,
    private readonly sessionService: ChatSessionService,
  ) {}

  async getOrCreateConversation(data: {
    serviceId: string;
    customerProfileId: string;
    providerId?: string;
  }) {
    return this.sessionService.getOrCreateConversation(data);
  }

  async setCounselorOnlineStatus(userId: string, isOnline: boolean) {
    return this.sessionService.setCounselorOnlineStatus(userId, isOnline);
  }

  async addParticipant(sessionId: string, userId: string) {
    return this.sessionService.addParticipant(sessionId, userId);
  }

  async leaveConversation(sessionId: string, userId: string) {
    return this.sessionService.leaveConversation(sessionId, userId);
  }

  async createInChatBooking(
    userId: string,
    data: {
      conversationId: string;
      serviceId: string;
      providerId?: string;
      customPrice?: number;
      addressText?: string;
      preferredTime?: string;
      notes?: string;
      paymentMode?: PaymentMode | string;
    },
  ) {
    return this.bookingService.createInChatBooking(userId, data);
  }

  async assignProviderToConversation(
    conversationId: string,
    providerIdentifier: string,
    assignedByUserId: string,
  ) {
    return this.bookingService.assignProviderToConversation(
      conversationId,
      providerIdentifier,
      assignedByUserId,
    );
  }

  async saveMessage(senderId: string, dto: SendMessageDto) {
    const conversationId = dto.conversationId || dto.sessionId;
    if (!conversationId) {
      throw new BadRequestException('Conversation ID is required');
    }

    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.chatSession.findUnique({
        where: {
          id: conversationId,
        },
        select: {
          id: true,
        },
      });

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      const sender = await tx.user.findUnique({
        where: {
          id: senderId,
        },
        select: {
          role: true,
          status: true,
        },
      });

      if (!sender || sender.status !== 'ACTIVE') {
        throw new ForbiddenException('Sender is not allowed');
      }

      if (dto.type === MessageType.SYSTEM) {
        throw new ForbiddenException('SYSTEM messages cannot be sent by users');
      }

      if (
        dto.type === MessageType.OFFER &&
        sender.role !== UserRole.PROVIDER &&
        sender.role !== UserRole.COUNSELOR &&
        sender.role !== UserRole.ADMIN &&
        sender.role !== UserRole.MANAGER
      ) {
        throw new ForbiddenException(
          'Only providers, counselors, or admins can send offers',
        );
      }

      const messageType = dto.type ?? MessageType.TEXT;
      const text = dto.text?.trim() || null;
      const fileUrl = dto.fileUrl?.trim() || null;

      if (messageType === MessageType.TEXT && !text) {
        throw new BadRequestException('Text is required');
      }

      const fileTypes: MessageType[] = [
        MessageType.IMAGE,
        MessageType.VIDEO,
        MessageType.AUDIO,
        MessageType.FILE,
      ];

      if (fileTypes.includes(messageType) && !fileUrl) {
        throw new BadRequestException(
          `File URL is required for ${messageType} messages`,
        );
      }

      const message = await tx.message.create({
        data: {
          sessionId: conversationId,
          senderId,
          text,
          fileUrl,
          type: messageType,
          isSend: true,
          isRead: false,
        },
        include: {
          sender: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      });

      await tx.chatSession.update({
        where: {
          id: conversationId,
        },
        data: {
          updatedAt: new Date(),
        },
      });

      return message;
    });
  }

  async getMessages(
    sessionId: string,
    limit = 50,
    offset = 0,
    currentUserId?: string,
  ) {
    if (currentUserId) {
      // Auto-mark incoming unread messages as read in the database
      await this.prisma.message.updateMany({
        where: {
          sessionId,
          senderId: { not: currentUserId },
          isRead: false,
        },
        data: {
          isRead: true,
        },
      });
    }

    return this.prisma.message.findMany({
      where: {
        sessionId,
        isDeleted: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
      skip: offset,
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
    });
  }

  async markConversationAsRead(userId: string, conversationId: string) {
    const updated = await this.prisma.message.updateMany({
      where: {
        sessionId: conversationId,
        senderId: { not: userId },
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });
    return { success: true, count: updated.count, conversationId };
  }

  async getUserConversations(userId: string, unreadOnly = false) {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    const isCounselor = currentUser?.role === UserRole.COUNSELOR;
    const isAdminOrStaff =
      currentUser?.role === UserRole.ADMIN ||
      currentUser?.role === UserRole.MANAGER ||
      currentUser?.role === UserRole.SUPPORT;

    let whereClause: any;

    if (isAdminOrStaff) {
      whereClause = {};
    } else if (isCounselor) {
      whereClause = {
        OR: [
          { counselorId: userId },
          { participants: { some: { userId, isActive: true } } },
          { flowType: 'CUSTOMER_COUNSELOR' },
        ],
      };
    } else {
      whereClause = {
        OR: [
          { customerId: userId },
          { customerUser: { id: userId } },
          { customerProfile: { userId } },
          { counselorId: userId },
          { providerId: userId },
          { participants: { some: { userId, isActive: true } } },
        ],
      };
    }

    const conversations = await this.prisma.chatSession.findMany({
      where: whereClause,
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        service: {
          include: {
            category: true,
          },
        },
        customerUser: {
          select: {
            id: true,
            name: true,
            mobileNumber: true,
            profilePhoto: true,
            role: true,
          },
        },
        counselorUser: {
          select: {
            id: true,
            name: true,
            mobileNumber: true,
            profilePhoto: true,
            role: true,
          },
        },
        providerUser: {
          select: {
            id: true,
            name: true,
            mobileNumber: true,
            profilePhoto: true,
            role: true,
          },
        },
        participants: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                role: true,
                status: true,
              },
            },
          },
        },
        messages: {
          where: { isDeleted: false },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          select: {
            id: true,
            text: true,
            type: true,
            createdAt: true,
            senderId: true,
            isRead: true,
          },
        },
        _count: {
          select: {
            messages: {
              where: { isDeleted: false },
            },
          },
        },
      },
    });

    if (conversations.length === 0) {
      return [];
    }

    // Batch query unread messages count per session for the authenticated user session
    const sessionIds = conversations.map((c) => c.id);
    const unreadCounts = await this.prisma.message.groupBy({
      by: ['sessionId'],
      where: {
        sessionId: { in: sessionIds },
        senderId: { not: userId },
        isRead: false,
        isDeleted: false,
      },
      _count: {
        id: true,
      },
    });

    const unreadMap = new Map<string, number>();
    for (const item of unreadCounts) {
      unreadMap.set(item.sessionId, item._count.id);
    }

    const enriched = conversations.map((conv) => {
      const unreadCount = unreadMap.get(conv.id) || 0;
      return {
        ...conv,
        unreadCount,
        lastMessage: conv.messages[0] || null,
      };
    });

    if (unreadOnly) {
      return enriched.filter((c) => c.unreadCount > 0);
    }

    return enriched;
  }
}
