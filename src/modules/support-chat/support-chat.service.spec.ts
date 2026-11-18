import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SupportChatService } from './support-chat.service';

const thread = { id: 't1', memberId: 'member-1' };

function build() {
  const prisma = {
    supportThread: {
      findUnique: jest.fn().mockResolvedValue(thread),
      update: jest.fn().mockResolvedValue({}),
    },
    supportMessage: {
      create: jest.fn().mockResolvedValue({ id: 'm1', text: 'hi', createdAt: new Date() }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'a', text: 'from member', createdAt: new Date(), senderId: 'member-1' },
        { id: 'b', text: 'from staff', createdAt: new Date(), senderId: 'admin-1' },
      ]),
    },
    user: { findUnique: jest.fn() },
  };
  return { prisma, service: new SupportChatService(prisma as never) };
}

describe('SupportChatService', () => {
  it('lets a member read only their own thread', async () => {
    const { service } = build();
    await expect(service.getMessages({ id: 'someone-else', role: 'CUSTOMER' }, 't1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getMessages({ id: 'member-1', role: 'CUSTOMER' }, 't1')).resolves.toHaveLength(2);
  });

  it('lets any staff role read any thread and marks who wrote what without naming staff', async () => {
    const { service } = build();
    const messages = await service.getMessages({ id: 'manager-9', role: 'MANAGER' }, 't1');
    expect(messages.map((message) => message.fromSupport)).toEqual([false, true]);
    expect(messages[1]).not.toHaveProperty('senderId');
  });

  it('keeps the directory and thread opening for staff', async () => {
    const { service } = build();
    await expect(service.listDirectory({ id: 'u', role: 'PROVIDER' }, 'CUSTOMER')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.openThreadForStaff({ id: 'u', role: 'CUSTOMER' }, 'x')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('only lets staff open a thread with a provider or customer', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue({ id: 'x', role: 'ADMIN' });
    await expect(service.openThreadForStaff({ id: 'admin-1', role: 'ADMIN' }, 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks phone numbers from members but not from staff', async () => {
    const { service, prisma } = build();
    await expect(service.sendMessage({ id: 'member-1', role: 'PROVIDER' }, 't1', 'call 01711111111')).rejects.toThrow();
    await expect(service.sendMessage({ id: 'admin-1', role: 'ADMIN' }, 't1', 'call 01711111111')).resolves.toMatchObject({ fromSupport: true });
    expect(prisma.supportMessage.create).toHaveBeenCalledTimes(1);
  });

  it('keeps support chat away from counselors', async () => {
    const { service } = build();
    await expect(service.getMine({ id: 'c', role: 'COUNSELOR' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
