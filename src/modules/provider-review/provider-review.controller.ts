import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateProviderReviewDto,
  UpdateProviderReviewDto,
} from './dto/provider-review.dto';
import { ProviderReviewService } from './provider-review.service';

@ApiTags('Provider Review')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('provider-review')
export class ProviderReviewController {
  constructor(private readonly providerReviewService: ProviderReviewService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create or update provider review for order' })
  create(@Req() req: any, @Body() data: CreateProviderReviewDto) {
    return this.providerReviewService.create(data, req.user?.id);
  }

  @Get()
  findAll() {
    return this.providerReviewService.findAll();
  }

  @Get('provider/:providerId')
  findByProvider(@Param('providerId', new ParseUUIDPipe()) providerId: string) {
    return this.providerReviewService.findByProvider(providerId);
  }

  @Get('customer/:customerId')
  findByCustomer(@Param('customerId', new ParseUUIDPipe()) customerId: string) {
    return this.providerReviewService.findByCustomer(customerId);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.providerReviewService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() data: UpdateProviderReviewDto,
  ) {
    return this.providerReviewService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.providerReviewService.remove(id);
  }
}
