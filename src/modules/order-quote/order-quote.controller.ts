import {
  Body,
  Controller,
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
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateOrderQuoteDto } from './dto/create-order-quote.dto';
import { OrderQuoteService } from './order-quote.service';

interface AuthenticatedRequest {
  user: { id: string; role: UserRole };
}

@ApiTags('Order Quotes')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrderQuoteController {
  constructor(private readonly quotes: OrderQuoteService) {}

  @Post(':orderId/quotes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Provider sends the price of a custom order after the visit',
  })
  send(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: CreateOrderQuoteDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quotes.send(orderId, dto, req.user);
  }

  @Get(':orderId/quotes')
  @ApiOperation({
    summary:
      'Prices sent for a custom order (its customer, provider and staff)',
  })
  list(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quotes.list(orderId, req.user);
  }

  @Patch('quotes/:quoteId/accept')
  @ApiOperation({
    summary: 'Customer accepts: the quote becomes the order price',
  })
  accept(
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quotes.respond(quoteId, 'ACCEPTED', req.user);
  }

  @Patch('quotes/:quoteId/reject')
  @ApiOperation({
    summary: 'Customer rejects: the order is cancelled, nothing to pay',
  })
  reject(
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quotes.respond(quoteId, 'REJECTED', req.user);
  }
}
