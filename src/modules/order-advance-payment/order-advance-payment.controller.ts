import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PayAdvanceDto } from './dto/pay-advance.dto';
import { OrderAdvancePaymentService } from './order-advance-payment.service';

@ApiTags('Order Advance Payment')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrderAdvancePaymentController {
  constructor(private readonly advance: OrderAdvancePaymentService) {}

  @Post(':orderId/advance-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer pays part of the bill early; the final payment is reduced by it' })
  pay(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Body() dto: PayAdvanceDto, @Req() req: { user: { id: string; role: UserRole } }) {
    return this.advance.pay(orderId, dto, req.user);
  }
}
