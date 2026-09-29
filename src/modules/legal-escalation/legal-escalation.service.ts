import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLegalEscalationDto } from './dto/create-legal-escalation.dto';

export interface LegalDossier {
  incidentReportId: string;
  generatedAt: string | Date;
  orderSummary: {
    id: string;
    serviceName?: string | null;
    orderStatus: string;
    paymentStatus: string;
    totalPrice: any;
    advancePaid: any;
    dueAmount: any;
  };
  customer: {
    name?: string | null;
    phone: string;
  };
  provider: {
    name?: string | null;
    phone: string;
    kycStatus?: string;
    nidNumber?: string | null;
    tradeLicenseNo?: string | null;
  };
  chatEvidenceCount: number;
  chatTranscript: Array<{
    sentAt: string | Date;
    sender: string;
    text?: string | null;
    fileUrl?: string | null;
  }>;
}

@Injectable()
export class LegalEscalationService {
  constructor(private readonly prisma: PrismaService) {}

  async escalateOrder(
    orderId: string,
    data: CreateLegalEscalationDto,
    escalatedByUserId?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        provider: {
          include: {
            user: true,
            kyc: true,
          },
        },
        customer: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock the order status as DISPUTED
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          orderStatus: 'DISPUTED',
        },
      });

      // 2. Lock Provider Account (Suspended & Unavailable)
      if (order.provider?.user?.id) {
        await tx.user.update({
          where: { id: order.provider.user.id },
          data: { status: 'SUSPENDED' },
        });

        await tx.providerProfile.update({
          where: { id: order.providerId },
          data: { isAvailable: false, isBlockedForNegative: true },
        });
      }

      // 3. Close all active chat slots for this customer/provider
      await tx.activeChatSlot.updateMany({
        where: {
          customerId: order.customerId,
          providerId: order.providerId,
          status: 'ACTIVE',
        },
        data: {
          status: 'CLOSED',
        },
      });

      // 4. Log Counselor / System Audit entry if chat session exists
      const chatSession = await tx.chatSession.findFirst({
        where: {
          customerProfileId: order.customerId,
          providerId: order.providerId,
        },
      });

      if (escalatedByUserId && chatSession) {
        const counselor = await tx.counselorProfile.findUnique({
          where: { userId: escalatedByUserId },
        });

        if (counselor) {
          await tx.counselorAuditLog.create({
            data: {
              counselorId: counselor.id,
              sessionId: chatSession.id,
              actionType: 'NOTE_ADDED',
              remarks: `[LEGAL ESCALATION] ${data.reason}. GD: ${data.policeGdNumber || 'N/A'}. Action: ${data.actionNotes || 'Locked accounts'}`,
            },
          });
        }
      }

      return {
        message:
          'Legal escalation executed: Order marked DISPUTED, provider account SUSPENDED, and chat slots CLOSED.',
        orderId: updatedOrder.id,
        escalationDetails: data,
        escalatedAt: new Date(),
      };
    });
  }

  async generateLegalReport(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        service: true,
        customer: {
          include: {
            user: {
              include: {
                addresses: true,
              },
            },
          },
        },
        provider: {
          include: {
            user: true,
            kyc: true,
          },
        },
        technician: {
          include: {
            user: true,
          },
        },
        paymentAndTip: true,
        revisions: true,
        providerReview: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Fetch conversation / messages for this customer and provider
    const messages = await this.prisma.message.findMany({
      where: {
        session: {
          customerProfileId: order.customerId,
          providerId: order.providerId,
        },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: {
          select: {
            name: true,
            role: true,
            mobileNumber: true,
          },
        },
      },
    });

    const reportDossier = {
      incidentReportId: `LEGAL-${order.id.slice(0, 8).toUpperCase()}`,
      generatedAt: new Date(),
      orderSummary: {
        id: order.id,
        serviceName: order.service?.name,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
        originalPrice: order.originalPrice,
        adminCommission: order.adminCommission,
        additionalPrice: order.additionalPrice,
        totalPrice: order.totalPrice,
        advancePaid: order.advancePaid,
        dueAmount: order.dueAmount,
        createdAt: order.createdAt,
      },
      customer: {
        name: order.customer?.user?.name,
        phone: order.customer?.user?.mobileNumber,
        email: order.customer?.user?.email,
        addresses: order.customer?.user?.addresses?.map((a) => a.addressText),
      },
      provider: {
        id: order.provider?.id,
        name: order.provider?.user?.name,
        phone: order.provider?.user?.mobileNumber,
        email: order.provider?.user?.email,
        rating: order.provider?.rating,
        walletBalance: order.provider?.walletBalance,
        kycStatus: order.provider?.kyc?.status,
        nidNumber: order.provider?.kyc?.nidNumber,
        tradeLicenseNo: order.provider?.kyc?.tradeLicenseNo,
      },
      technician: order.technician
        ? {
            name: order.technician.user?.name,
            phone: order.technician.user?.mobileNumber,
          }
        : null,
      payment: order.paymentAndTip,
      revisions: order.revisions,
      reviews: order.providerReview,
      chatEvidenceCount: messages.length,
      chatTranscript: messages.map((m) => ({
        sender: `${m.sender?.name || 'Unknown'} (${m.sender?.role || 'USER'})`,
        phone: m.sender?.mobileNumber,
        text: m.text,
        fileUrl: m.fileUrl,
        sentAt: m.createdAt,
      })),
    };

    const printableHtml = this.renderPrintableHtml(reportDossier);

    return {
      dossier: reportDossier,
      printableHtml,
    };
  }

  async getEscalatedCases() {
    return this.prisma.order.findMany({
      where: {
        orderStatus: 'DISPUTED',
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        service: true,
        customer: {
          include: {
            user: {
              select: { name: true, mobileNumber: true },
            },
          },
        },
        provider: {
          include: {
            user: {
              select: { name: true, mobileNumber: true },
            },
          },
        },
        paymentAndTip: true,
      },
    });
  }

  private renderPrintableHtml(dossier: LegalDossier): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Legal Audit Dossier - ${dossier.incidentReportId}</title>
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 30px; color: #1e293b; line-height: 1.5; }
    h1 { color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; font-size: 22px; }
    h2 { color: #334155; font-size: 16px; margin-top: 24px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
    .badge-disputed { background: #fee2e2; color: #b91c1c; padding: 3px 8px; border-radius: 4px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
    th { background: #f8fafc; color: #475569; width: 25%; }
    .chat-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; margin-top: 10px; max-height: 400px; overflow-y: auto; font-size: 12px; }
    .chat-msg { padding: 4px 0; border-bottom: 1px dashed #e2e8f0; }
  </style>
</head>
<body>
  <h1>Official Incident & Legal Evidence Report</h1>
  <p><strong>Report Reference:</strong> ${dossier.incidentReportId} | <strong>Generated:</strong> ${new Date(dossier.generatedAt).toLocaleString()}</p>

  <h2>1. Order Summary</h2>
  <table>
    <tr><th>Order ID</th><td>${dossier.orderSummary.id}</td><th>Service</th><td>${dossier.orderSummary.serviceName || 'N/A'}</td></tr>
    <tr><th>Status</th><td><span class="badge-disputed">${dossier.orderSummary.orderStatus}</span></td><th>Payment Status</th><td>${dossier.orderSummary.paymentStatus}</td></tr>
    <tr><th>Total Price</th><td>${dossier.orderSummary.totalPrice} BDT</td><th>Advance / Due</th><td>${dossier.orderSummary.advancePaid} / ${dossier.orderSummary.dueAmount} BDT</td></tr>
  </table>

  <h2>2. Parties Involved</h2>
  <table>
    <tr><th>Customer Name</th><td>${dossier.customer.name || 'N/A'}</td><th>Customer Phone</th><td>${dossier.customer.phone}</td></tr>
    <tr><th>Provider Agency / Name</th><td>${dossier.provider.name || 'N/A'}</td><th>Provider Phone</th><td>${dossier.provider.phone}</td></tr>
    <tr><th>Provider KYC Status</th><td>${dossier.provider.kycStatus || 'UNVERIFIED'}</td><th>NID / Trade License</th><td>${dossier.provider.nidNumber || 'N/A'} / ${dossier.provider.tradeLicenseNo || 'N/A'}</td></tr>
  </table>

  <h2>3. Chat & Communication Evidence (${dossier.chatEvidenceCount} messages)</h2>
  <div class="chat-box">
    ${dossier.chatTranscript
      .map(
        (t) =>
          `<div class="chat-msg"><strong>[${new Date(t.sentAt).toLocaleTimeString()}] ${t.sender}:</strong> ${t.text || (t.fileUrl ? '[Attached File]' : '')}</div>`,
      )
      .join('')}
  </div>
</body>
</html>
    `;
  }
}
