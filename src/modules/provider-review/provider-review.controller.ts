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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import {
  CreateProviderReviewDto,
  ReviewVisibilityDto,
  UpdateProviderReviewDto,
} from './dto/provider-review.dto';
import { ProviderReviewService } from './provider-review.service';

@ApiTags('Provider Review')
@ApiBearerAuth('JWT-auth')
// Every route names who may use it: before, any signed-in user could read every review with the people's private
// details, change any review (stars, text, visibility) or delete it.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('provider-review')
export class ProviderReviewController {
  constructor(private readonly providerReviewService: ProviderReviewService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create or update provider review for order' })
  create(@Req() req: any, @Body() data: CreateProviderReviewDto) {
    return this.providerReviewService.create(data, req.user?.id);
  }

  @Get('me/received')
  @ApiOperation({
    summary: "The signed-in person's profile summary: rating, latest reviews with who wrote each, completed orders, and total spent (customer) or income (provider, technician)",
  })
  findMine(@Req() req: { user: { id: string; role: string } }) {
    return this.providerReviewService.receivedBy(req.user);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  findAll() {
    return this.providerReviewService.findAll();
  }

  @Get('provider/:providerId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  findByProvider(@Param('providerId', new ParseUUIDPipe()) providerId: string) {
    return this.providerReviewService.findByProvider(providerId);
  }

  @Get('customer/:customerId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  findByCustomer(@Param('customerId', new ParseUUIDPipe()) customerId: string) {
    return this.providerReviewService.findByCustomer(customerId);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.providerReviewService.findOne(id);
  }

  @Patch(':id/visibility')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'ADMIN: show or hide a review (new reviews are public); the provider rating follows' })
  setVisibility(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ReviewVisibilityDto) {
    return this.providerReviewService.setVisibility(id, dto.isPublic);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() data: UpdateProviderReviewDto,
  ) {
    return this.providerReviewService.update(id, data);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.providerReviewService.remove(id);
  }
}
