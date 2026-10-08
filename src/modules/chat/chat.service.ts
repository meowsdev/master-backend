import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageType, PaymentMode, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateConversation(data: {
    serviceId: string;
    customerProfileId: string;
    providerId?: string;
  }) {
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

      // Resolve provider User ID if providerId was supplied (either User ID or ProviderProfile ID)
      let resolvedProviderUserId: string | null = null;
      if (data.providerId) {
        const directUser = await tx.user.findUnique({
          where: { id: data.providerId },
          select: { id: true },
        });
        if (directUser) {
          resolvedProviderUserId = directUser.id;
        } else {
          const provProfile = await tx.providerProfile.findUnique({
            where: { id: data.providerId },
            select: { userId: true },
          });
          if (provProfile) {
            resolvedProviderUserId = provProfile.userId;
          }
        }
      }

      if (session) {
        // Ensure customer is registered as active participant
        await tx.chatParticipant.upsert({
          where: {
            sessionId_userId: {
              sessionId: session.id,
              userId: customerProfile.userId,
            },
          },
          update: {
            isActive: true,
            leftAt: null,
          },
          create: {
            sessionId: session.id,
            userId: customerProfile.userId,
            isActive: true,
          },
        });

        if (resolvedProviderUserId) {
          await tx.chatParticipant.upsert({
            where: {
              sessionId_userId: {
                sessionId: session.id,
                userId: resolvedProviderUserId,
              },
            },
            update: {
              isActive: true,
              leftAt: null,
            },
            create: {
              sessionId: session.id,
              userId: resolvedProviderUserId,
              isActive: true,
            },
          });
          if (!session.providerId) {
            await tx.chatSession.update({
              where: { id: session.id },
              data: { providerId: resolvedProviderUserId },
            });
          }
        }

        return tx.chatSession.findUnique({
          where: { id: session.id },
          include: {
            participants: {
              include: {
                user: true,
              },
            },
          },
        });
      }

      let assignedCounselorId: string | null = null;
      let assignedProviderId: string | null = resolvedProviderUserId;
      const flowType = assignedProviderId
        ? 'CUSTOMER_PROVIDER'
        : 'CUSTOMER_COUNSELOR';

      if (!assignedProviderId) {
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

        if (leastLoadedCounselor) {
          assignedCounselorId = leastLoadedCounselor.userId;
        }
      }

      session = await tx.chatSession.create({
        data: {
          customerId: customerProfile.userId,
          customerProfileId: data.customerProfileId,
          serviceId: data.serviceId,
          counselorId: assignedCounselorId,
          providerId: assignedProviderId,
          flowType,
          assignedAt: assignedCounselorId || assignedProviderId ? new Date() : null,
        },
        include: {
          participants: {
            include: { user: true },
          },
        },
      });

      await tx.chatParticipant.upsert({
        where: {
          sessionId_userId: {
            sessionId: session.id,
            userId: customerProfile.userId,
          },
        },
        update: {
          isActive: true,
          leftAt: null,
        },
        create: {
          sessionId: session.id,
          userId: customerProfile.userId,
          isActive: true,
        },
      });

      if (assignedCounselorId) {
        await tx.chatParticipant.upsert({
          where: {
            sessionId_userId: {
              sessionId: session.id,
              userId: assignedCounselorId,
            },
          },
          update: {
            isActive: true,
            leftAt: null,
          },
          create: {
            sessionId: session.id,
            userId: assignedCounselorId,
            isActive: true,
          },
        });

        await tx.counselorProfile.updateMany({
          where: {
            userId: assignedCounselorId,
          },
          data: {
            activeChatCount: { increment: 1 },
          },
        });
      }

      if (assignedProviderId) {
        await tx.chatParticipant.upsert({
          where: {
            sessionId_userId: {
              sessionId: session.id,
              userId: assignedProviderId,
            },
          },
          update: {
            isActive: true,
            leftAt: null,
          },
          create: {
            sessionId: session.id,
            userId: assignedProviderId,
            isActive: true,
          },
        });
      }

      return tx.chatSession.findUnique({
        where: { id: session.id },
        include: {
          participants: {
            include: {
              user: true,
            },
          },
        },
      });
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
    return this.prisma.$transaction(async (tx) => {
      // 1. Get or create customer profile
      let customerProfile = await tx.customerProfile.findUnique({
        where: { userId },
      });
      if (!customerProfile) {
        customerProfile = await tx.customerProfile.create({
          data: { userId },
        });
      }

      // 2. Validate service
      const service = await tx.service.findUnique({
        where: { id: data.serviceId },
      });
      if (!service) {
        throw new NotFoundException('Service not found');
      }

      // 2.1 Prevent duplicate active running orders
      const existingActiveOrder = await tx.order.findFirst({
        where: {
          customerId: customerProfile.id,
          serviceId: service.id,
          orderStatus: {
            in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'],
          },
        },
      });

      if (existingActiveOrder) {
        throw new BadRequestException(
          `You already have an active running order (#${existingActiveOrder.id.slice(0, 8).toUpperCase()}) with status "${existingActiveOrder.orderStatus}". Please wait until it is completed or cancel it before placing another order.`,
        );
      }

      // 3. Resolve provider profile
      let providerProfileId: string | null = null;
      if (data.providerId) {
        const prov = await tx.providerProfile.findUnique({
          where: { id: data.providerId },
          select: { id: true },
        });
        if (prov) {
          providerProfileId = prov.id;
        } else {
          const provByUser = await tx.providerProfile.findUnique({
            where: { userId: data.providerId },
            select: { id: true },
          });
          if (provByUser) providerProfileId = provByUser.id;
        }
      }

      // Fallback to first available provider
      if (!providerProfileId) {
        const anyProvider = await tx.providerProfile.findFirst({
          select: { id: true },
        });
        if (anyProvider) {
          providerProfileId = anyProvider.id;
        } else {
          const defaultProvUser = await tx.user.findFirst({
            where: { role: 'PROVIDER' },
          });
          if (defaultProvUser) {
            const newProv = await tx.providerProfile.create({
              data: { userId: defaultProvUser.id },
            });
            providerProfileId = newProv.id;
          }
        }
      }

      if (!providerProfileId) {
        throw new BadRequestException(
          'No provider profile available to assign this order.',
        );
      }

      const originalPrice = data.customPrice ?? Number(service.basePrice);
      const totalPrice = originalPrice;

      // 4. Create Order
      const order = await tx.order.create({
        data: {
          customerId: customerProfile.id,
          providerId: providerProfileId,
          serviceId: service.id,
          originalPrice,
          totalPrice,
          advancePaid: 0,
          dueAmount: totalPrice,
          orderStatus: 'PENDING',
          paymentStatus: 'UNPAID',
        },
        include: {
          service: true,
          provider: {
            include: {
              user: true,
            },
          },
          customer: {
            include: {
              user: true,
            },
          },
        },
      });

      // 5. Create Order Payment Record
      await tx.orderPaymentAndTip.create({
        data: {
          orderId: order.id,
          paymentMode: (data.paymentMode as PaymentMode) ?? PaymentMode.CASH,
          serviceAmountPaid: 0,
          confirmationStatus: 'PENDING',
        },
      });

      // 6. Save automated Confirmation Message in Chat
      const shortOrderId = order.id.slice(0, 8).toUpperCase();
      const systemMessageText = JSON.stringify({
        type: 'ORDER_CONFIRMED',
        orderId: order.id,
        shortOrderId,
        serviceName: service.name,
        price: totalPrice,
        address: data.addressText || 'Customer Address',
        preferredTime: data.preferredTime || 'Today, Fast Dispatch',
        paymentMode: data.paymentMode ?? 'CASH',
        status: 'PENDING',
        warranty: '3-Day Free Warranty Included',
      });

      const message = await tx.message.create({
        data: {
          sessionId: data.conversationId,
          senderId: userId,
          text: systemMessageText,
          type: MessageType.SYSTEM,
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
        where: { id: data.conversationId },
        data: { updatedAt: new Date() },
      });

      return {
        order,
        message,
      };
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

  async getUserConversations(userId: string) {
    return this.prisma.chatSession.findMany({
      where: {
        OR: [
          { customerId: userId },
          { customerUser: { id: userId } },
          { customerProfile: { userId } },
          { counselorId: userId },
          { providerId: userId },
          { participants: { some: { userId, isActive: true } } },
        ],
      },
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
            messages: true,
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

