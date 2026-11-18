// The real sessions service pulls in an ES-module-only JWT package that Jest cannot load; only its type is needed here.
jest.mock('./sessions.service', () => ({ SessionsService: class SessionsService {} }));

import { AuthService } from './auth.service';

const user = { id: 'u1', mobileNumber: '01700000777', role: 'TECHNICIAN', name: 'Manik' };

function build(found: Array<{ id: string; mobileNumber: string }>) {
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue(found),
      update: jest.fn().mockResolvedValue(user),
      create: jest.fn().mockResolvedValue({ ...user, id: 'new' }),
    },
    customerProfile: { upsert: jest.fn() },
  };
  const otp = { verify: jest.fn().mockResolvedValue(undefined) };
  const sessions = { createSession: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }) };
  return { service: new AuthService(prisma as never, sessions as never, otp as never, {} as never), prisma };
}

describe('AuthService.verifyOtp finds an account however its number was written', () => {
  it('signs a technician stored as 01700000777 in, instead of creating a second customer', async () => {
    const { service, prisma } = build([{ id: 'u1', mobileNumber: '01700000777' }]);
    const result = await service.verifyOtp({ phoneNumber: '+8801700000777', code: '123456' });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { mobileNumber: { in: ['+8801700000777', '8801700000777', '01700000777'] } } }));
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' } }));
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(result.user.role).toBe('TECHNICIAN');
  });

  it('prefers the account stored in the exact form when both exist', async () => {
    const { service, prisma } = build([
      { id: 'legacy', mobileNumber: '01700000777' },
      { id: 'exact', mobileNumber: '+8801700000777' },
    ]);
    await service.verifyOtp({ phoneNumber: '+8801700000777', code: '123456' });
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'exact' } }));
  });

  it('creates an account only for a number nobody has', async () => {
    const { service, prisma } = build([]);
    await service.verifyOtp({ phoneNumber: '+8801799999999', code: '123456' });
    expect(prisma.user.create).toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
