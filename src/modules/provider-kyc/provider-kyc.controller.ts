import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  AdminVerifyProviderKycDto,
  ReviewProviderKycDto,
  SubmitProviderKycDto,
} from './dto/provider-kyc.dto';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { KYC_FILE_DIR, KYC_FILE_EXTENSIONS } from './kyc-rules';
import { ProviderKycService } from './provider-kyc.service';

interface AuthenticatedRequest {
  user: { id: string; role: UserRole };
}

/*
 * Every route names who may use it. (Before, two routes only checked that someone was logged in: any user could
 * read another provider's KYC or approve their own.)
 */
@ApiTags('Provider KYC')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('provider-kyc')
export class ProviderKycController {
  constructor(private readonly kyc: ProviderKycService) {}

  @Get('me')
  @Roles(UserRole.PROVIDER, UserRole.CUSTOMER)
  @ApiOperation({
    summary:
      'PROVIDER: my verification, whether I may get orders, and my grace period',
  })
  findMine(@Req() req: AuthenticatedRequest) {
    return this.kyc.findMine(req.user.id);
  }

  @Post('apply')
  @Roles(UserRole.PROVIDER, UserRole.CUSTOMER)
  @ApiOperation({
    summary:
      'CUSTOMER: start becoming a provider on the same number (opens the KYC); nothing changes until an admin approves',
  })
  apply(@Req() req: AuthenticatedRequest) {
    return this.kyc.apply(req.user.id);
  }

  @Post('me/documents')
  @Roles(UserRole.PROVIDER, UserRole.CUSTOMER)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'PROVIDER: upload one private picture (NID front / back, photo); returns its key',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      storage: diskStorage({
        destination: (_req, _file, done) => {
          mkdirSync(KYC_FILE_DIR, { recursive: true });
          done(null, KYC_FILE_DIR);
        },
        // The uploader's id is part of the name, so a key proves who uploaded it; the rest is random.
        filename: (req, file, done) =>
          done(
            null,
            `${(req as unknown as AuthenticatedRequest).user.id}_${randomUUID()}${extname(file.originalname).toLowerCase()}`,
          ),
      }),
      fileFilter: (_req, file, done) => {
        const isAllowed = KYC_FILE_EXTENSIONS.includes(
          extname(file.originalname).toLowerCase(),
        );
        done(
          isAllowed
            ? null
            : new BadRequestException(
                'Only JPG, PNG or WEBP pictures are allowed',
              ),
          isAllowed,
        );
      },
    }),
  )
  uploadDocument(@UploadedFile() file?: { filename: string }) {
    if (!file) throw new BadRequestException('Choose a picture');
    return { key: file.filename };
  }

  @Put('me')
  @Roles(UserRole.PROVIDER, UserRole.CUSTOMER)
  @ApiOperation({
    summary: 'PROVIDER: send (or send again) my verification for admin review',
  })
  submitMine(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SubmitProviderKycDto,
  ) {
    return this.kyc.submitMine(req.user.id, dto);
  }

  @Get('files/:key')
  @Roles(UserRole.PROVIDER, UserRole.CUSTOMER, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'A private KYC picture: only its owner or an admin / manager',
  })
  file(
    @Param('key') key: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(this.kyc.filePath(key, req.user));
  }

  @Get('member/:userId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: "ADMIN / MANAGER: one provider's verification by their user id",
  })
  findForMember(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.kyc.findForMember(userId);
  }

  @Post('member/:userId/documents')
  @Roles(UserRole.ADMIN)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      "ADMIN: upload one KYC picture for a provider; it is the provider's file (they can see it too)",
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      storage: diskStorage({
        destination: (_req, _file, done) => {
          mkdirSync(KYC_FILE_DIR, { recursive: true });
          done(null, KYC_FILE_DIR);
        },
        // Named for the provider (from the path, checked to be a user id), so the file is theirs like their own upload.
        filename: (req, file, done) => {
          const userId = String(
            (req.params as { userId?: string }).userId ?? '',
          );
          if (!UUID_PATTERN.test(userId))
            return done(new BadRequestException('Invalid provider'), '');
          done(
            null,
            `${userId.toLowerCase()}_${randomUUID()}${extname(file.originalname).toLowerCase()}`,
          );
        },
      }),
      fileFilter: (_req, file, done) => {
        const isAllowed = KYC_FILE_EXTENSIONS.includes(
          extname(file.originalname).toLowerCase(),
        );
        done(
          isAllowed
            ? null
            : new BadRequestException(
                'Only JPG, PNG or WEBP pictures are allowed',
              ),
          isAllowed,
        );
      },
    }),
  )
  uploadMemberDocument(
    @Param('userId', new ParseUUIDPipe()) _userId: string,
    @UploadedFile() file?: { filename: string },
  ) {
    if (!file) throw new BadRequestException('Choose a picture');
    return { key: file.filename };
  }

  @Put('member/:userId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary:
      "ADMIN: fill in a provider's whole KYC and verify it at once (they accept the terms on first visit)",
  })
  verifyForMember(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: AdminVerifyProviderKycDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.kyc.verifyForMember(userId, dto, req.user.id);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'ADMIN: approve, or reject with a reason the provider sees',
  })
  review(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReviewProviderKycDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.kyc.review(id, dto, req.user.id);
  }
}
