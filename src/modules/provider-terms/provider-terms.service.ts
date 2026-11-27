import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KycStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DEFAULT_TERMS_SECTIONS,
  DEFAULT_TERMS_TITLE,
  TermsSection,
} from './default-terms';

export interface ProviderTerms {
  version: number;
  title: string;
  sections: TermsSection[];
  /** null for the built-in version 1. */
  publishedAt: Date | null;
}

const BUILT_IN: ProviderTerms = {
  version: 1,
  title: DEFAULT_TERMS_TITLE,
  sections: DEFAULT_TERMS_SECTIONS,
  publishedAt: null,
};

type Client =
  | Pick<PrismaService, 'providerTermsAcceptance' | 'providerKyc'>
  | Prisma.TransactionClient;

/*
 * The provider terms (conduct and liability). An admin publishes new versions; nothing is ever edited or deleted,
 * so what each provider accepted can always be shown. Providers accept them with their KYC, and an approved
 * provider is asked once to accept each newer version. Every acceptance is recorded (ProviderTermsAcceptance).
 */
@Injectable()
export class ProviderTermsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The version providers must accept now: the latest published, or the built-in version 1. */
  async current(): Promise<ProviderTerms> {
    const row = await this.prisma.providerTermsVersion.findFirst({
      orderBy: { version: 'desc' },
    });
    return row
      ? {
          version: row.version,
          title: row.title,
          sections: row.sections as unknown as TermsSection[],
          publishedAt: row.createdAt,
        }
      : BUILT_IN;
  }

  /** Admin: every version, newest first, the built-in one included. */
  async versions(): Promise<ProviderTerms[]> {
    const rows = await this.prisma.providerTermsVersion.findMany({
      orderBy: { version: 'desc' },
    });
    const published = rows.map((row) => ({
      version: row.version,
      title: row.title,
      sections: row.sections as unknown as TermsSection[],
      publishedAt: row.createdAt,
    }));
    return published.some((terms) => terms.version === 1)
      ? published
      : [...published, BUILT_IN];
  }

  /** Admin: a new version from the edited text. Approved providers are asked to accept it on their next visit. */
  async publish(
    input: { title: string; sections: TermsSection[] },
    adminId: string,
  ): Promise<ProviderTerms> {
    const title = input.title.trim();
    const sections = input.sections
      .map((section) => ({
        heading: section.heading.trim(),
        points: section.points.map((point) => point.trim()).filter(Boolean),
      }))
      .filter((section) => section.heading && section.points.length > 0);
    if (!title) throw new BadRequestException('Write a title');
    if (sections.length === 0)
      throw new BadRequestException(
        'Add at least one section with a heading and a point',
      );

    const next = (await this.current()).version + 1;
    try {
      const row = await this.prisma.providerTermsVersion.create({
        data: {
          version: next,
          title,
          sections: sections,
          createdById: adminId,
        },
      });
      return {
        version: row.version,
        title: row.title,
        sections,
        publishedAt: row.createdAt,
      };
    } catch (error) {
      // Two admins saving at once: the second gets the same number and must look at the new version first.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Someone published a new version just now. Reload and check it before saving.',
        );
      }
      throw error;
    }
  }

  /** The provider's side: the current terms and whether they still have to accept them. */
  async mine(userId: string) {
    const [terms, provider] = await Promise.all([
      this.current(),
      this.providerOf(userId),
    ]);
    const acceptedVersion = provider.kyc?.termsVersion
      ? Number(provider.kyc.termsVersion)
      : null;
    return {
      terms,
      acceptedVersion,
      // Only a verified provider is asked again; everyone else accepts with their KYC.
      needsAcceptance:
        provider.kyc?.status === KycStatus.APPROVED &&
        acceptedVersion !== terms.version,
    };
  }

  /** The provider accepts the version on their screen. It must still be the current one. */
  async accept(userId: string, version: number) {
    const [terms, provider] = await Promise.all([
      this.current(),
      this.providerOf(userId),
    ]);
    if (version !== terms.version)
      throw new ConflictException(
        'The terms changed again. Read the new version and accept it.',
      );
    await this.prisma.$transaction(async (tx) =>
      this.recordAcceptance(tx, provider.id, version),
    );
    return this.mine(userId);
  }

  /** Keeps an acceptance as proof, and on the KYC the latest version accepted. */
  async recordAcceptance(client: Client, providerId: string, version: number) {
    await client.providerTermsAcceptance.create({
      data: { providerId, version },
    });
    await client.providerKyc.updateMany({
      where: { providerId },
      data: { termsVersion: String(version), termsAcceptedAt: new Date() },
    });
  }

  private async providerOf(userId: string) {
    const provider = await this.prisma.providerProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        kyc: { select: { status: true, termsVersion: true } },
      },
    });
    if (!provider) throw new NotFoundException('Provider profile not found');
    return provider;
  }
}
