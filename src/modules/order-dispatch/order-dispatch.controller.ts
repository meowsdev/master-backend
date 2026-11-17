import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrderDispatchService } from './order-dispatch.service';

@ApiTags('Order Dispatch')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrderDispatchController {
  constructor(private readonly dispatch: OrderDispatchService) {}

  @Post(':orderId/decline-offer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provider turns down the offer of a new order (the order stays open for other providers)' })
  decline(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Req() req: { user: { id: string; role: UserRole } }) {
    return this.dispatch.declineOffer(orderId, req.user);
  }
}
