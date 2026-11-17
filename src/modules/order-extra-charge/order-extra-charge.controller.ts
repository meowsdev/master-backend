import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateExtraChargeDto } from './dto/create-extra-charge.dto';
import { OrderExtraChargeService } from './order-extra-charge.service';

interface AuthenticatedRequest {
  user: { id: string; role: UserRole };
}

@ApiTags('Order Extra Charges')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrderExtraChargeController {
  constructor(private readonly extraCharges: OrderExtraChargeService) {}

  @Post(':orderId/extra-charges')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Provider asks the customer to approve extra charges' })
  request(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Body() dto: CreateExtraChargeDto, @Req() req: AuthenticatedRequest) {
    return this.extraCharges.request(orderId, dto, req.user);
  }

  @Get(':orderId/extra-charges')
  @ApiOperation({ summary: 'Extra-charge requests of an order (customer and assigned provider only)' })
  list(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Req() req: AuthenticatedRequest) {
    return this.extraCharges.list(orderId, req.user);
  }

  @Patch('extra-charges/:requestId/approve')
  @ApiOperation({ summary: 'Customer approves: the amount is added to the order price' })
  approve(@Param('requestId', new ParseUUIDPipe()) requestId: string, @Req() req: AuthenticatedRequest) {
    return this.extraCharges.respond(requestId, 'APPROVED', req.user);
  }

  @Patch('extra-charges/:requestId/reject')
  @ApiOperation({ summary: 'Customer rejects: the order price is unchanged' })
  reject(@Param('requestId', new ParseUUIDPipe()) requestId: string, @Req() req: AuthenticatedRequest) {
    return this.extraCharges.respond(requestId, 'REJECTED', req.user);
  }
}
