import { BadRequestException, Controller, Post, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

export const ORDER_IMAGE_DIR = join(process.cwd(), 'uploads', 'order-images');
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

@ApiTags('Uploads')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadsController {
  @Post('order-images')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('images', 5, {
      limits: { fileSize: 5 * 1024 * 1024 },
      storage: diskStorage({
        destination: (_req, _file, done) => {
          mkdirSync(ORDER_IMAGE_DIR, { recursive: true });
          done(null, ORDER_IMAGE_DIR);
        },
        // A random name means a client can neither guess nor overwrite another upload.
        filename: (_req, file, done) =>
          done(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
      }),
      fileFilter: (_req, file, done) => {
        const isAllowed = ALLOWED_EXTENSIONS.includes(extname(file.originalname).toLowerCase());
        done(isAllowed ? null : new BadRequestException('Only JPG, PNG or WEBP images are allowed'), isAllowed);
      },
    }),
  )
  uploadOrderImages(@UploadedFiles() files: Array<{ filename: string }>) {
    return { urls: (files ?? []).map((file) => `/uploads/order-images/${file.filename}`) };
  }
}
