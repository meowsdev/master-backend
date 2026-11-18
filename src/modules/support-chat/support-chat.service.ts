import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertNoPhoneNumber } from '../../common/contact-privacy';

/** Platform staff who answer on the support side of every thread. */
const STAFF_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPPORT];
/** The people staff can write to. */
const MEMBER_ROLES: UserRole[] = [UserRole.PROVIDER, UserRole.TECHNICIAN, UserRole.CUSTOMER];

/** The admin has one list per kind of person. */
const ROLES_BY_DIRECTORY: Record<'PROVIDER' | 'TECHNICIAN' | 'CUSTOMER', UserRole[]> = {
  PROVIDER: [UserRole.PROVIDER],
  TECHNICIAN: [UserRole.TECHNICIAN],
  CUSTOMER: [UserRole.CUSTOMER],
};

export const isSupportStaff = (role: string) => STAFF_ROLES.includes(role as UserRole);
const isSupportMember = (role: string) => MEMBER_ROLES.includes(role as UserRole);

interface Viewer {
  id: string;
  role: string;
}

@Injectable()
export class SupportChatService {
  constructor(private readonly prisma: PrismaService) {}

  /** Staff list of every provider or customer, each with the latest message and how many they have not read. */
  async listDirectory(viewer: Viewer, role: 'PROVIDER' | 'TECHNICIAN' | 'CUSTOMER', search?: string) {
    this.assertStaff(viewer);
    const term = search?.trim();

    const members = await this.prisma.user.findMany({
      where: {
        role: { in: ROLES_BY_DIRECTORY[role] },
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { username: { contains: term, mode: 'insensitive' } },
                { mobileNumber: { contains: term } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        username: true,
        mobileNumber: true,
        profilePhoto: true,
        role: true,
        status: true,
        isRestricted: true,
        supportThread: {
          select: {
            id: true,
            lastStaffReadAt: true,
            messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { text: true, createdAt: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    const rows = await Promise.all(
      members.map(async ({ supportThread, ...member }) => {
        const lastMessage = supportThread?.messages[0] ?? null;
        const unreadCount = supportThread
          ? await this.prisma.supportMessage.count({
              where: {
                threadId: supportThread.id,
                senderId: member.id,
                ...(supportThread.lastStaffReadAt ? { createdAt: { gt: supportThread.lastStaffReadAt } } : {}),
              },
            })
          : 0;
        return { ...member, threadId: supportThread?.id ?? null, lastMessage, unreadCount };
      }),
    );

    // People you already talk to come first, newest conversation on top.
    return rows.sort((a, b) => {
      if (a.lastMessage && b.lastMessage) return b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime();
      if (a.lastMessage) return -1;
      if (b.lastMessage) return 1;
      return 0;
    });
  }

  /** Staff open (or start) the thread with one provider or customer. */
  async openThreadForStaff(viewer: Viewer, memberId: string) {
    this.assertStaff(viewer);
    const member = await this.prisma.user.findUnique({
      where: { id: memberId },
      select: { id: true, name: true, username: true, mobileNumber: true, profilePhoto: true, role: true },
    });
    if (!member || !isSupportMember(member.role)) throw new NotFoundException('Provider, technician or customer not found');
    const thread = await this.getOrCreateThread(member.id);
    return { threadId: thread.id, member };
  }

  /** A provider or customer's own thread; null until someone has written. */
  async getMine(viewer: Viewer) {
    this.assertMember(viewer);
    const thread = await this.prisma.supportThread.findUnique({
      where: { memberId: viewer.id },
      select: {
        id: true,
        lastMemberReadAt: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { text: true, createdAt: true } },
      },
    });
    if (!thread) return { threadId: null, unreadCount: 0, lastMessage: null };

    const unreadCount = await this.prisma.supportMessage.count({
      where: {
        threadId: thread.id,
        senderId: { not: viewer.id },
        ...(thread.lastMemberReadAt ? { createdAt: { gt: thread.lastMemberReadAt } } : {}),
      },
    });
    return { threadId: thread.id, unreadCount, lastMessage: thread.messages[0] ?? null };
  }

  /** Members start their own thread the first time they open "Support". */
  async openOwnThread(viewer: Viewer) {
    this.assertMember(viewer);
    const thread = await this.getOrCreateThread(viewer.id);
    return { threadId: thread.id };
  }

  async getMessages(viewer: Viewer, threadId: string) {
    const thread = await this.loadAuthorizedThread(viewer, threadId);
    const messages = await this.prisma.supportMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: { id: true, text: true, createdAt: true, senderId: true },
    });
    // Members only learn "this is from Support", never which staff member wrote it.
    return messages.map(({ senderId, ...message }) => ({ ...message, fromSupport: senderId !== thread.memberId }));
  }

  async sendMessage(viewer: Viewer, threadId: string, text: string) {
    const thread = await this.loadAuthorizedThread(viewer, threadId);
    const trimmed = text.trim();
    if (!trimmed) throw new BadRequestException('Message is empty');
    // Providers and customers keep the conversation in the app, like everywhere else.
    if (!isSupportStaff(viewer.role)) assertNoPhoneNumber(trimmed);

    const message = await this.prisma.supportMessage.create({
      data: { threadId, senderId: viewer.id, text: trimmed },
      select: { id: true, text: true, createdAt: true },
    });
    await this.prisma.supportThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });
    return { ...message, fromSupport: viewer.id !== thread.memberId };
  }

  async markRead(viewer: Viewer, threadId: string) {
    await this.loadAuthorizedThread(viewer, threadId);
    await this.prisma.supportThread.update({
      where: { id: threadId },
      data: isSupportStaff(viewer.role) ? { lastStaffReadAt: new Date() } : { lastMemberReadAt: new Date() },
    });
    return { ok: true };
  }

  private getOrCreateThread(memberId: string) {
    return this.prisma.supportThread.upsert({
      where: { memberId },
      update: {},
      create: { memberId },
      select: { id: true },
    });
  }

  /** Staff may open any thread; a member only their own. Anyone else is turned away. */
  private async loadAuthorizedThread(viewer: Viewer, threadId: string) {
    const thread = await this.prisma.supportThread.findUnique({ where: { id: threadId }, select: { id: true, memberId: true } });
    if (!thread) throw new NotFoundException('Conversation not found');
    if (!isSupportStaff(viewer.role) && thread.memberId !== viewer.id) {
      throw new ForbiddenException('This conversation is not yours');
    }
    return thread;
  }

  private assertStaff(viewer: Viewer) {
    if (!isSupportStaff(viewer.role)) throw new ForbiddenException('Only platform staff can do this');
  }

  private assertMember(viewer: Viewer) {
    if (!isSupportMember(viewer.role)) throw new ForbiddenException('Support chat is for providers, technicians and customers');
  }
}
