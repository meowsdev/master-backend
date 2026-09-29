import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateChatSessionDto } from './dto/create-chatSession.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateConversation(data: CreateChatSessionDto) {
    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: {
        id: data.customerProfileId,
      },
      select: {
        userId: true,
      },
    });

    if (!customerProfile) {
      throw new NotFoundException('Customer profile not found');
    }

    return this.prisma.$transaction(async (tx) => {
      let session = await tx.chatSession.findUnique({
        where: {
          customerProfileId_serviceId: {
            customerProfileId: data.customerProfileId,
            serviceId: data.serviceId,
          },
        },
        include: {
          participants: {
            include: {
              user: true,
            },
          },
        },
      });

      if (session) {
        return session;
      }

      const leastLoadedCounselor = await tx.counselorProfile.findFirst({
        where: {
          isOnline: true,
          user: {
            status: 'ACTIVE',
          },
        },
        orderBy: {
          activeChatCount: 'asc',
        },
      });

      session = await tx.chatSession.create({
        data: {
          customerId: customerProfile.userId,
          customerProfileId: data.customerProfileId,
          serviceId: data.serviceId,
          counselorId: leastLoadedCounselor
            ? leastLoadedCounselor.userId
            : null,
          flowType: 'CUSTOMER_COUNSELOR',
          assignedAt: leastLoadedCounselor ? new Date() : null,
        },
        include: {
          participants: {
            include: { user: true },
          },
        },
      });

      await tx.chatParticipant.create({
        data: {
          sessionId: session.id,
          userId: customerProfile.userId,
          isActive: true,
        },
      });

      if (leastLoadedCounselor) {
        await tx.chatParticipant.create({
          data: {
            sessionId: session.id,
            userId: leastLoadedCounselor.userId,
            isActive: true,
          },
        });

        await tx.counselorProfile.update({
          where: {
            id: leastLoadedCounselor.id,
          },
          data: {
            activeChatCount: { increment: 1 },
          },
        });
      }

      return session;
    });
  }

  async setCounselorOnlineStatus(userId: string, isOnline: boolean) {
    const counselor = await this.prisma.counselorProfile.findUnique({
      where: { userId },
    });
    if (!counselor) {
      throw new NotFoundException('Counselor profile not found');
    }
    return this.prisma.counselorProfile.update({
      where: { userId },
      data: { isOnline },
    });
  }
  async addParticipant(sessionId: string, userId: string) {
    return this.prisma.chatParticipant.upsert({
      where: {
        sessionId_userId: {
          sessionId,
          userId,
        },
      },
      update: {
        isActive: true,
        leftAt: null,
      },
      create: {
        sessionId,
        userId,
        isActive: true,
      },
      include: {
        user: true,
      },
    });
  }

  async saveMessage(senderId: string, dto: SendMessageDto) {
    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.chatSession.findUnique({
        where: {
          id: dto.conversationId,
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

      if (dto.type === MessageType.OFFER && sender.role !== UserRole.PROVIDER) {
        throw new ForbiddenException('Only providers can send offers');
      }

      const messageType = dto.type ?? MessageType.TEXT;
      const text = dto.text?.trim();
      const fileUrl = dto.fileUrl?.trim();

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
          sessionId: dto.conversationId,
          senderId,
          text: dto.text,
          fileUrl: dto.fileUrl,
          type: dto.type,
          isSend: true,
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
          id: dto.conversationId,
        },
        data: {
          updatedAt: new Date(),
        },
      });

      return message;
    });
  }

  async getMessages(sessionId: string, limit = 50, offset = 0) {
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

  async leaveConversation(sessionId: string, userId: string) {
    return this.prisma.chatParticipant.updateMany({
      where: {
        sessionId,
        userId,
        isActive: true,
      },
      data: {
        isActive: false,
        leftAt: new Date(),
      },
    });
  }
}
