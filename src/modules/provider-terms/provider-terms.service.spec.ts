import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProviderTermsService } from './provider-terms.service';

const sections = [{ heading: 'Conduct', points: ['No violence.'] }];

function build(
  latest: { version: number } | null,
  kyc: { status: string; termsVersion: string | null } | null = null,
) {
  const tx = {
    providerTermsAcceptance: { create: jest.fn() },
    providerKyc: { updateMany: jest.fn() },
  };
  const prisma = {
    providerTermsVersion: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          latest
            ? { ...latest, title: 'Terms', sections, createdAt: new Date() }
            : null,
        ),
      findMany: jest
        .fn()
        .mockResolvedValue(
          latest
            ? [{ ...latest, title: 'Terms', sections, createdAt: new Date() }]
            : [],
        ),
      create: jest
        .fn()
        .mockImplementation(
          ({ data }: { data: { version: number; title: string } }) =>
            Promise.resolve({ ...data, createdAt: new Date() }),
        ),
    },
    providerProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: 'pp1', kyc }),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  return { service: new ProviderTermsService(prisma as never), prisma, tx };
}

describe('the provider terms in force', () => {
  it('is the built-in version 1 until an admin publishes one', async () => {
    await expect(build(null).service.current()).resolves.toMatchObject({
      version: 1,
      publishedAt: null,
    });
  });

  it('lists the built-in version 1 under the published ones, so its text stays visible', async () => {
    const versions = await build({ version: 2 }).service.versions();
    expect(versions.map((terms) => terms.version)).toEqual([2, 1]);
  });
});

describe('an admin publishing new terms', () => {
  it('saves them as the next version, cleaned up', async () => {
    const { service, prisma } = build(null);
    await service.publish(
      {
        title: ' New terms ',
        sections: [
          { heading: ' Conduct ', points: [' No violence. ', '  '] },
          { heading: '', points: ['x'] },
        ],
      },
      'admin',
    );
    expect(prisma.providerTermsVersion.create).toHaveBeenCalledWith({
      data: {
        version: 2,
        title: 'New terms',
        sections: [{ heading: 'Conduct', points: ['No violence.'] }],
        createdById: 'admin',
      },
    });
  });

  it('refuses empty terms', async () => {
    await expect(
      build(null).service.publish(
        { title: 'T', sections: [{ heading: 'H', points: [' '] }] },
        'admin',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('providers accepting', () => {
  it('asks a verified provider once for a newer version', async () => {
    await expect(
      build(
        { version: 2 },
        { status: 'APPROVED', termsVersion: '1' },
      ).service.mine('u1'),
    ).resolves.toMatchObject({ needsAcceptance: true, acceptedVersion: 1 });
    await expect(
      build(
        { version: 2 },
        { status: 'APPROVED', termsVersion: '2' },
      ).service.mine('u1'),
    ).resolves.toMatchObject({ needsAcceptance: false });
  });

  it('does not ask someone who is not verified (they accept with their KYC)', async () => {
    await expect(
      build(
        { version: 2 },
        { status: 'PENDING', termsVersion: '1' },
      ).service.mine('u1'),
    ).resolves.toMatchObject({ needsAcceptance: false });
  });

  it('records the acceptance as proof and on the KYC', async () => {
    const { service, tx } = build(
      { version: 2 },
      { status: 'APPROVED', termsVersion: '1' },
    );
    await service.accept('u1', 2);
    expect(tx.providerTermsAcceptance.create).toHaveBeenCalledWith({
      data: { providerId: 'pp1', version: 2 },
    });
    const [[update]] = tx.providerKyc.updateMany.mock.calls as [
      [{ where: unknown; data: { termsVersion: string } }],
    ];
    expect(update.where).toEqual({ providerId: 'pp1' });
    expect(update.data.termsVersion).toBe('2');
  });

  it('refuses an acceptance of an older version', async () => {
    await expect(
      build(
        { version: 3 },
        { status: 'APPROVED', termsVersion: '1' },
      ).service.accept('u1', 2),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
