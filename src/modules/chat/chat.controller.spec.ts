jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));
jest.mock('../auth/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));

import { ChatController, ChatHistoryQueryDto } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { PrismaService } from '../../prisma/prisma.service';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

describe('ChatController', () => {
  const req = { user: { id: 'customer-user' } } as Parameters<
    ChatController['sendMessage']
  >[0];
  const chat = {
    getOrCreateConversation: jest.fn(),
    addParticipant: jest.fn(),
    saveMessage: jest.fn(),
    getMessages: jest.fn(),
    markConversationAsRead: jest.fn(),
    getUserConversations: jest.fn(),
  };
  const prisma = {
    customerProfile: { findUnique: jest.fn(), create: jest.fn() },
    service: { findFirst: jest.fn() },
    chatSession: { findFirst: jest.fn(), update: jest.fn() },
    user: { findUnique: jest.fn() },
    chatParticipant: { upsert: jest.fn() },
  };
  const gateway = {
    publishMessage: jest.fn(),
    publishMessagesRead: jest.fn(),
  };
  let controller: ChatController;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.chatParticipant.upsert.mockResolvedValue({});
    prisma.chatSession.update.mockResolvedValue({});
    controller = new ChatController(
      chat as unknown as ChatService,
      prisma as unknown as PrismaService,
      gateway as unknown as ChatGateway,
    );
  });

  it('rejects creating a conversation when service is not found', async () => {
    prisma.customerProfile.findUnique.mockResolvedValue({ id: 'profile' });
    prisma.service.findFirst.mockResolvedValue(null);
    await expect(
      controller.getOrCreateConversation(req, {
        customerProfileId: 'profile',
        serviceId: 'service',
      }),
    ).rejects.toThrow('No active service found to create consultation');
    expect(chat.getOrCreateConversation).not.toHaveBeenCalled();
  });

  it('creates conversation when active service is found', async () => {
    prisma.customerProfile.findUnique.mockResolvedValue({ id: 'profile' });
    prisma.service.findFirst.mockResolvedValue({ id: 'service-1' });
    chat.getOrCreateConversation.mockResolvedValue({ id: 'conv-1' });

    const result = await controller.getOrCreateConversation(req, {
      customerProfileId: 'profile',
      serviceId: 'service-1',
    });
    expect(result).toEqual({ id: 'conv-1' });
    expect(chat.getOrCreateConversation).toHaveBeenCalledWith({
      customerProfileId: 'profile',
      serviceId: 'service-1',
      providerId: undefined,
    });
  });

  it('denies message history to outsiders', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: req.user.id, role: 'CUSTOMER' });
    prisma.chatSession.findFirst.mockResolvedValue(null);
    await expect(
      controller.getMessages(req, '00000000-0000-0000-0000-000000000001', { limit: 50, offset: 0 }),
    ).rejects.toThrow('Conversation access denied');
    expect(chat.getMessages).not.toHaveBeenCalled();
  });

  it('rejects blank messages', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: req.user.id, role: 'CUSTOMER' });
    prisma.chatSession.findFirst.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
    await expect(
      controller.sendMessage(req, {
        conversationId: '00000000-0000-0000-0000-000000000001',
        text: ' ',
      }),
    ).rejects.toThrow('Message text or file URL is required');
    expect(chat.saveMessage).not.toHaveBeenCalled();
  });

  it('uses the authenticated sender and publishes the saved message', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: req.user.id, role: 'CUSTOMER' });
    prisma.chatSession.findFirst.mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' });
    prisma.chatParticipant.upsert.mockResolvedValue({});
    const dto = { conversationId: '00000000-0000-0000-0000-000000000001', text: 'Hello' };
    const message = { id: 'message', sessionId: dto.conversationId, ...dto };
    chat.saveMessage.mockResolvedValue(message);
    await expect(controller.sendMessage(req, dto)).resolves.toEqual(message);
    expect(chat.saveMessage).toHaveBeenCalledWith(req.user.id, dto);
    expect(gateway.publishMessage).toHaveBeenCalledWith(message);
  });

  it('marks conversation messages as read and publishes event', async () => {
    const convId = '00000000-0000-0000-0000-000000000001';
    prisma.user.findUnique.mockResolvedValue({ id: req.user.id, role: 'CUSTOMER' });
    prisma.chatSession.findFirst.mockResolvedValue({ id: convId });
    prisma.chatParticipant.upsert.mockResolvedValue({});
    chat.markConversationAsRead.mockResolvedValue({ success: true, count: 2, conversationId: convId });

    const result = await controller.markAsRead(req, convId);
    expect(result).toEqual({ success: true, count: 2, conversationId: convId });
    expect(chat.markConversationAsRead).toHaveBeenCalledWith(req.user.id, convId);
    expect(gateway.publishMessagesRead).toHaveBeenCalledWith(convId, req.user.id);
  });

  it('passes unreadOnly parameter to getUserConversations', async () => {
    chat.getUserConversations.mockResolvedValue([]);
    await controller.getMyConversations(req, 'true');
    expect(chat.getUserConversations).toHaveBeenCalledWith(req.user.id, true);

    await controller.getMyConversations(req, 'false');
    expect(chat.getUserConversations).toHaveBeenCalledWith(req.user.id, false);
  });

  it('converts valid query strings and rejects unsafe pagination', async () => {
    const valid = plainToInstance(ChatHistoryQueryDto, {
      limit: '25',
      offset: '0',
    });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.limit).toBe(25);
    for (const query of [
      { limit: '101' },
      { offset: '-1' },
      { limit: 'abc' },
    ]) {
      expect(
        (await validate(plainToInstance(ChatHistoryQueryDto, query))).length,
      ).toBeGreaterThan(0);
    }
  });
});
