import { BadRequestException, Body, Controller, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { mkdirSync, writeFileSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { buildHugeiconSvg } from './hugeicon-svg';

export const SERVICE_PICTURE_DIR = join(process.cwd(), 'uploads', 'service-pictures');
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * The address a stored picture is reached at. It is a full URL so every screen (and the Next image
 * component) can show it as it is. Set PUBLIC_API_URL behind a proxy or load balancer; otherwise the
 * address the request came in on is used.
 */
function publicUrl(req: Request, path: string): string {
  const base = process.env.PUBLIC_API_URL?.replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
  return `${base}${path}`;
}

@ApiTags('Uploads')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('uploads')
export class ServicePicturesController {
  @Post('service-pictures')
  @ApiOperation({ summary: 'ADMIN: upload an image for a service or main service' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 },
      storage: diskStorage({
        destination: (_req, _file, done) => {
          mkdirSync(SERVICE_PICTURE_DIR, { recursive: true });
          done(null, SERVICE_PICTURE_DIR);
        },
        // A random name means nobody can guess or overwrite another upload.
        filename: (_req, file, done) => done(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
      }),
      fileFilter: (_req, file, done) => {
        const isAllowed = ALLOWED_EXTENSIONS.includes(extname(file.originalname).toLowerCase());
        done(isAllowed ? null : new BadRequestException('Only JPG, PNG or WEBP images are allowed'), isAllowed);
      },
    }),
  )
  uploadImage(@UploadedFile() file: { filename: string } | undefined, @Req() req: Request) {
    if (!file) throw new BadRequestException('Choose an image to upload');
    return { url: publicUrl(req, `/uploads/service-pictures/${file.filename}`) };
  }

  @Post('hugeicon')
  @ApiOperation({ summary: 'ADMIN: store a chosen Hugeicons icon as a picture' })
  saveHugeicon(@Body() body: { name?: string; elements?: unknown }, @Req() req: Request) {
    const name = typeof body.name === 'string' ? body.name : '';
    if (!/^[A-Za-z0-9]{1,80}$/.test(name)) throw new BadRequestException('Invalid icon name');

    // Written from checked data only; see buildHugeiconSvg.
    const svg = buildHugeiconSvg(body.elements);
    mkdirSync(SERVICE_PICTURE_DIR, { recursive: true });
    const fileName = `hugeicon-${name}-${randomUUID().slice(0, 8)}.svg`;
    writeFileSync(join(SERVICE_PICTURE_DIR, fileName), svg, 'utf8');
    return { url: publicUrl(req, `/uploads/service-pictures/${fileName}`) };
  }
}
