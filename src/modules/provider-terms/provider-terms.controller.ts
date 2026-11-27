import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  AcceptProviderTermsDto,
  PublishProviderTermsDto,
} from './dto/provider-terms.dto';
import { ProviderTermsService } from './provider-terms.service';

interface AuthenticatedRequest {
  user: { id: string; role: UserRole };
}

@ApiTags('Provider terms')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ProviderTermsController {
  constructor(private readonly terms: ProviderTermsService) {}

  @Get('provider-terms/current')
  @Roles(UserRole.PROVIDER, UserRole.CUSTOMER, UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'The provider terms in force now (shown before sending a KYC)',
  })
  current() {
    return this.terms.current();
  }

  @Get('provider-terms/me')
  @Roles(UserRole.PROVIDER, UserRole.CUSTOMER)
  @ApiOperation({
    summary:
      'PROVIDER: the current terms and whether I still have to accept them',
  })
  mine(@Req() req: AuthenticatedRequest) {
    return this.terms.mine(req.user.id);
  }

  @Post('provider-terms/accept')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.PROVIDER, UserRole.CUSTOMER)
  @ApiOperation({
    summary:
      'PROVIDER: accept the current version of the terms (recorded as proof)',
  })
  accept(
    @Req() req: AuthenticatedRequest,
    @Body() dto: AcceptProviderTermsDto,
  ) {
    return this.terms.accept(req.user.id, dto.version);
  }

  @Get('admin/provider-terms')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'ADMIN: every version of the provider terms, newest first',
  })
  versions() {
    return this.terms.versions();
  }

  @Post('admin/provider-terms')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary:
      'ADMIN: publish a new version; approved providers are asked to accept it on their next visit',
  })
  publish(
    @Body() dto: PublishProviderTermsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.terms.publish(dto, req.user.id);
  }
}
