import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KycStatus, Prisma, UserRole } from '@prisma/client';
import { existsSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { phoneLookupVariants } from '../../common/phone';
import { LocationsService } from '../locations/locations.service';
import { ProviderTermsService } from '../provider-terms/provider-terms.service';
import {
  ReviewProviderKycDto,
  SubmitProviderKycDto,
} from './dto/provider-kyc.dto';
import {
  KYC_FILE_DIR,
  isValidNid,
  kycAllowsOrders,
  kycFileOwner,
  normalizeBdMobile,
} from './kyc-rules';

/** Staff who may look at a provider's KYC (their NID and family numbers). Only an ADMIN approves or rejects. */
const KYC_VIEWER_ROLES: string[] = [UserRole.ADMIN, UserRole.MANAGER];

const KYC_SELECT = {
  id: true,
  status: true,
  fullName: true,
  fatherName: true,
  motherName: true,
  gender: true,
  contactPhone: true,
  districtId: true,
  upazilaId: true,
  postCode: true,
  addressDetail: true,
  nidNumber: true,
  tradeLicenseNo: true,
  nidFrontUrl: true,
  nidBackUrl: true,
  selfieUrl: true,
  emergencyContacts: true,
  submittedAt: true,
  termsAcceptedAt: true,
  termsVersion: true,
  reviewedAt: true,
  rejectReason: true,
} satisfies Prisma.ProviderKycSelect;

/*
 * A provider's identity check: name, home address, NID number and both sides of the card, their photo, and two or
 * three family members to call when they cannot be reached. The provider sends it (PENDING); an admin approves or
 * rejects it with a reason, and the provider can fix and send it again. Until it is approved a new provider gets no
 * orders; providers who were working before KYC was required keep getting them through their grace period.
 */
@Injectable()
export class ProviderKycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
    private readonly terms: ProviderTermsService,
  ) {}

  private async providerOf(userId: string) {
    const provider = await this.prisma.providerProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        kycGraceUntil: true,
        user: { select: { mobileNumber: true, name: true } },
        kyc: { select: KYC_SELECT },
        _count: { select: { serviceAreas: true } },
      },
    });
    if (!provider) throw new NotFoundException('Provider profile not found');
    return provider;
  }

  /** The provider's own page: their KYC (null before the first send), whether they may get orders, and until when. */
  async findMine(userId: string) {
    const provider = await this.providerOf(userId);
    return {
      kyc: provider.kyc,
      canReceiveOrders: kycAllowsOrders({
        kycGraceUntil: provider.kycGraceUntil,
        kyc: provider.kyc,
      }),
      graceUntil:
        provider.kyc?.status === KycStatus.APPROVED
          ? null
          : provider.kycGraceUntil,
      hasServiceAreas: provider._count.serviceAreas > 0,
      accountName: provider.user.name,
      // The login number, to start the form's phone field with.
      accountPhone: provider.user.mobileNumber,
    };
  }

  /**
   * A customer starts becoming a provider on the same number: they get a provider side (no orders, no grace) so they
   * can fill in the KYC. They stay a customer; once an admin approves, Switch Account can take them to provider.
   * Safe to call again.
   */
  async apply(userId: string) {
    await this.prisma.providerProfile.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    return this.findMine(userId);
  }

  /** Sends (or sends again) the form. An approved KYC is locked: a change goes through support. */
  async submitMine(userId: string, dto: SubmitProviderKycDto) {
    const provider = await this.providerOf(userId);
    if (provider.kyc?.status === KycStatus.APPROVED)
      throw new ConflictException(
        'Your verification is already approved. Contact support to change it.',
      );
    if (provider._count.serviceAreas === 0)
      throw new BadRequestException('Choose at least one area where you work');
    if (!this.locations.isValidLocation(dto.districtId, dto.upazilaId))
      throw new BadRequestException(
        'Please choose a valid district and upazila',
      );

    // The phone is always the login number: it cannot be changed here, whatever the form sends.
    const contactPhone = provider.user.mobileNumber;
    if (!/^\d{4}$/.test(dto.postCode.trim()))
      throw new BadRequestException('The post code must be 4 digits');

    const nidNumber = dto.nidNumber.replace(/\s/g, '');
    if (!isValidNid(nidNumber))
      throw new BadRequestException(
        'The NID number must be 10, 13 or 17 digits',
      );

    for (const key of [dto.nidFrontKey, dto.nidBackKey, dto.selfieKey])
      this.assertOwnFile(key, userId);
    if (new Set([dto.nidFrontKey, dto.nidBackKey, dto.selfieKey]).size < 3)
      throw new BadRequestException(
        'The NID front, back and your photo must be three different pictures',
      );

    // Family numbers must be other people, never the provider's own (login) number.
    const emergencyContacts = this.checkedContacts(dto, [contactPhone]);
    // The terms they accepted must be the ones in force: if the admin published new ones while the form was open,
    // they read and accept those first.
    const terms = await this.terms.current();
    if (dto.termsVersion.trim() !== String(terms.version)) {
      throw new ConflictException(
        'The provider terms have changed. Read the new version and accept it to send.',
      );
    }
    const fullName = dto.fullName.trim();
    const data = {
      fullName,
      fatherName: dto.fatherName.trim(),
      motherName: dto.motherName.trim(),
      gender: dto.gender,
      contactPhone,
      districtId: dto.districtId,
      upazilaId: dto.upazilaId,
      postCode: dto.postCode.trim(),
      addressDetail: dto.addressDetail.trim(),
      nidNumber,
      tradeLicenseNo: dto.tradeLicenseNo?.trim() || null,
      nidFrontUrl: dto.nidFrontKey,
      nidBackUrl: dto.nidBackKey,
      selfieUrl: dto.selfieKey,
      emergencyContacts: emergencyContacts as unknown as Prisma.InputJsonValue,
      status: KycStatus.PENDING,
      submittedAt: new Date(),
      // Every send is a fresh acceptance of the terms shown just before it.
      termsAcceptedAt: new Date(),
      termsVersion: String(terms.version),
      reviewedAt: null,
      reviewedById: null,
      rejectReason: null,
    };

    await this.prisma.$transaction([
      this.prisma.providerKyc.upsert({
        where: { providerId: provider.id },
        create: { providerId: provider.id, ...data },
        update: data,
      }),
      // The acceptance of the terms they just read, kept as proof.
      this.prisma.providerTermsAcceptance.create({
        data: { providerId: provider.id, version: terms.version },
      }),
      // The account had no name yet (phone-only login): the name on the NID becomes it.
      ...(provider.user.name?.trim()
        ? []
        : [
            this.prisma.user.update({
              where: { id: userId },
              data: { name: fullName },
            }),
          ]),
    ]);
    return this.findMine(userId);
  }

  /** Two or three different family numbers, none of them the provider's own. Stored as +8801XXXXXXXXX. */
  private checkedContacts(
    dto: SubmitProviderKycDto,
    ownNumbers: Array<string | null>,
  ) {
    const own = new Set(
      ownNumbers.flatMap((number) =>
        number ? phoneLookupVariants(number) : [],
      ),
    );
    const contacts = dto.emergencyContacts.map((contact) => {
      const phone = normalizeBdMobile(contact.phone);
      if (!phone)
        throw new BadRequestException(
          `"${contact.phone}" is not a valid mobile number`,
        );
      if (own.has(phone))
        throw new BadRequestException(
          'An emergency contact must be someone else, not your own number',
        );
      return {
        name: contact.name.trim(),
        relation: contact.relation.trim(),
        phone,
      };
    });
    if (
      new Set(contacts.map((contact) => contact.phone)).size < contacts.length
    )
      throw new BadRequestException(
        'Each emergency contact needs a different number',
      );
    return contacts;
  }

  /** A key from POST /me/documents by this same user, still on disk. */
  private assertOwnFile(key: string, userId: string) {
    if (kycFileOwner(key) !== userId || !existsSync(join(KYC_FILE_DIR, key))) {
      throw new BadRequestException(
        'Upload the pictures again: one of them was not found',
      );
    }
  }

  /** Where a private KYC picture is on disk, if the asker may see it: its owner, or an admin / manager. */
  filePath(key: string, actor: { id: string; role: string }) {
    const owner = kycFileOwner(key);
    if (!owner) throw new NotFoundException('File not found');
    if (owner !== actor.id && !KYC_VIEWER_ROLES.includes(actor.role))
      throw new ForbiddenException('You cannot see this file');
    const path = join(KYC_FILE_DIR, key);
    if (!existsSync(path)) throw new NotFoundException('File not found');
    return path;
  }

  /** Staff: one provider's KYC by their user id, with their phone (null when they never sent one). */
  async findForMember(memberUserId: string) {
    const provider = await this.prisma.providerProfile.findUnique({
      where: { userId: memberUserId },
      select: {
        kycGraceUntil: true,
        user: { select: { name: true, mobileNumber: true } },
        kyc: { select: KYC_SELECT },
      },
    });
    if (!provider) throw new NotFoundException('Provider not found');
    return {
      kyc: provider.kyc,
      canReceiveOrders: kycAllowsOrders({
        kycGraceUntil: provider.kycGraceUntil,
        kyc: provider.kyc,
      }),
      graceUntil:
        provider.kyc?.status === KycStatus.APPROVED
          ? null
          : provider.kycGraceUntil,
      accountName: provider.user.name,
      mobileNumber: provider.user.mobileNumber,
    };
  }

  /** Admin: approve, or reject with the reason the provider will see. Only a KYC waiting for review. */
  async review(kycId: string, dto: ReviewProviderKycDto, adminId: string) {
    const reason = dto.reason?.trim() || null;
    if (dto.status === KycStatus.REJECTED && !reason)
      throw new BadRequestException(
        'Write why it is rejected, so the provider can fix it',
      );
    const updated = await this.prisma.providerKyc.updateMany({
      where: { id: kycId, status: KycStatus.PENDING },
      data: {
        status: dto.status,
        rejectReason: dto.status === KycStatus.REJECTED ? reason : null,
        reviewedAt: new Date(),
        reviewedById: adminId,
      },
    });
    if (updated.count === 0)
      throw new ConflictException(
        'This verification is not waiting for review',
      );
    return this.prisma.providerKyc.findUniqueOrThrow({
      where: { id: kycId },
      select: KYC_SELECT,
    });
  }
}
