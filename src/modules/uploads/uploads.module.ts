import { Module } from '@nestjs/common';
import { ServicePicturesController } from './service-pictures.controller';
import { UploadsController } from './uploads.controller';

@Module({ controllers: [UploadsController, ServicePicturesController] })
export class UploadsModule {}
