import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ChatSessionService {
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

      // Resolve counselor if this is a customer-counselor flow
      let assignedCounselorId: string | null = null;
      let assignedProviderId: string | null = resolvedProviderUserId;

      if (!assignedProviderId) {
        let counselor = await tx.counselorProfile.findFirst({
          where: {
            user: {
              status: 'ACTIVE',
            },
          },
          orderBy: [
            { isOnline: 'desc' },
            { activeChatCount: 'asc' },
          ],
        });

        if (!counselor) {
          const counselorUser = await tx.user.findFirst({
            where: {
              role: UserRole.COUNSELOR,
              status: 'ACTIVE',
            },
          });
          if (counselorUser) {
            counselor = await tx.counselorProfile.upsert({
              where: { userId: counselorUser.id },
              update: { isOnline: true },
              create: {
                userId: counselorUser.id,
                isOnline: true,
                activeChatCount: 0,
              },
            });
          }
        }

        if (counselor) {
          assignedCounselorId = counselor.userId;
        }
      }

      const flowType = assignedProviderId
        ? 'CUSTOMER_PROVIDER'
        : 'CUSTOMER_COUNSELOR';

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

        // Ensure counselor is assigned and registered as participant if missing
        if (!session.counselorId && assignedCounselorId) {
          await tx.chatSession.update({
            where: { id: session.id },
            data: { counselorId: assignedCounselorId, assignedAt: new Date() },
          });
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
        } else if (session.counselorId) {
          await tx.chatParticipant.upsert({
            where: {
              sessionId_userId: {
                sessionId: session.id,
                userId: session.counselorId,
              },
            },
            update: {
              isActive: true,
              leftAt: null,
            },
            create: {
              sessionId: session.id,
              userId: session.counselorId,
              isActive: true,
            },
          });
        }

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
