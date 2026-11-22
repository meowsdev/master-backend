import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompleteOrderDto, PayOnlineDto } from './dto/order-completion.dto';
import { OrderCompletionService } from './order-completion.service';

interface AuthenticatedRequest {
  user: { id: string; role: UserRole };
}

@ApiTags('Order Completion')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrderCompletionController {
  constructor(private readonly completion: OrderCompletionService) {}

  @Post(':orderId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provider finishes the work: cash completes at once, online waits for the customer to pay' })
  complete(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Body() dto: CompleteOrderDto, @Req() req: AuthenticatedRequest) {
    return this.completion.complete(orderId, dto, req.user);
  }

  @Post(':orderId/finish-revision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provider marks the revision (re-work) as done; the order is completed again without new charges' })
  finishRevision(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Req() req: AuthenticatedRequest) {
    return this.completion.finishRevision(orderId, req.user);
  }

  @Post(':orderId/pay-online')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer accepts and pays online (optional tip); the order completes on success' })
  payOnline(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Body() dto: PayOnlineDto, @Req() req: AuthenticatedRequest) {
    return this.completion.payOnline(orderId, dto, req.user);
  }
}
