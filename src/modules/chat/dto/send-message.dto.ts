import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType } from '@prisma/client';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';

const CLIENT_MESSAGE_TYPES = [
  MessageType.TEXT,
  MessageType.IMAGE,
  MessageType.VIDEO,
  MessageType.AUDIO,
  MessageType.FILE,
  MessageType.OFFER,
];

export class SendMessageDto {
  @ApiProperty({
    format: 'uuid',
    example: '6e7f4f75-d1dc-49eb-90ad-854d8fe363d0',
  })
  @IsUUID()
  @IsNotEmpty()
  conversationId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Alias for conversationId',
  })
  @IsUUID()
  @IsOptional()
  sessionId?: string;

  @ApiPropertyOptional({
    maxLength: 1000,
    example: 'Hello, I need help with this service.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  text?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/uploads/file.png',
  })
  @IsString()
  @IsOptional()
  fileUrl?: string;

  @ApiPropertyOptional({
    enum: CLIENT_MESSAGE_TYPES,
    default: MessageType.TEXT,
  })
  @IsIn(CLIENT_MESSAGE_TYPES)
  @IsOptional()
  type?: MessageType;
}
