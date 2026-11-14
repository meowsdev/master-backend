import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MessageType, PaymentMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ChatBookingService {
  constructor(private readonly prisma: PrismaService) {}

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

      // 2.1 Prevent duplicate active running orders for same service
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
      const adminCommission = Math.round(originalPrice * 0.1);
      const totalPrice = originalPrice;

      // 4. Create Order
      const order = await tx.order.create({
        data: {
          customerId: customerProfile.id,
          providerId: providerProfileId,
          serviceId: service.id,
          originalPrice,
          adminCommission,
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

  async assignProviderToConversation(
    conversationId: string,
    providerIdentifier: string,
    assignedByUserId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.chatSession.findUnique({
        where: { id: conversationId },
        include: {
          service: true,
          customerProfile: { include: { user: true } },
        },
      });

      if (!session) {
        throw new NotFoundException('Conversation not found');
      }

      // 1. Resolve Provider User and Profile
      let providerUser = await tx.user.findFirst({
        where: {
          id: providerIdentifier,
          role: 'PROVIDER',
          status: 'ACTIVE',
        },
        include: { providerProfile: true },
      });

      if (!providerUser) {
        const byProfile = await tx.providerProfile.findUnique({
          where: { id: providerIdentifier },
          include: { user: true },
        });
        if (byProfile?.user) {
          providerUser = { ...byProfile.user, providerProfile: byProfile };
        }
      }

      if (!providerUser) {
        throw new BadRequestException('Active provider not found');
      }

      let providerProfile = providerUser.providerProfile;
      if (!providerProfile) {
        providerProfile = await tx.providerProfile.create({
          data: {
            userId: providerUser.id,
            isAvailable: true,
            rating: 5.0,
            experienceYears: 3,
          },
        });
      }

      // 2. Ensure Service Assignee
      await tx.serviceAssignee.upsert({
        where: {
          userId_serviceId: {
            userId: providerUser.id,
            serviceId: session.serviceId,
          },
        },
        update: { isActive: true },
        create: {
          userId: providerUser.id,
          serviceId: session.serviceId,
          isActive: true,
        },
      });

      // 3. Update Chat Session
      const updatedSession = await tx.chatSession.update({
        where: { id: conversationId },
        data: {
          providerId: providerUser.id,
          updatedAt: new Date(),
        },
      });

      // 4. Register Provider as Active Chat Participant
      await tx.chatParticipant.upsert({
        where: {
          sessionId_userId: {
            sessionId: conversationId,
            userId: providerUser.id,
          },
        },
        update: {
          isActive: true,
          leftAt: null,
        },
        create: {
          sessionId: conversationId,
          userId: providerUser.id,
          isActive: true,
        },
      });

      // 5. Update Any Active Order for this Customer & Service
      const activeOrder = await tx.order.findFirst({
        where: {
          customerId: session.customerProfileId,
          serviceId: session.serviceId,
          orderStatus: {
            in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'],
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (activeOrder) {
        await tx.order.update({
          where: { id: activeOrder.id },
          data: {
            providerId: providerProfile.id,
          },
        });
      }

      // 6. Post Confirmation Message in Chat
      const providerName = providerUser.name || providerUser.mobileNumber;
      const message = await tx.message.create({
        data: {
          sessionId: conversationId,
          senderId: assignedByUserId,
          text: `👨‍🔧 Verified Provider "${providerName}" has been assigned to this consultation & order. Provider will arrive according to the schedule.`,
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

      return {
        session: updatedSession,
        provider: providerUser,
        message,
        orderId: activeOrder?.id,
      };
    });
  }
}
