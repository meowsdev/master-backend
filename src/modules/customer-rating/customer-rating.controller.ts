import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RateCustomerDto } from './dto/rate-customer.dto';
import { CustomerRatingService } from './customer-rating.service';

interface AuthenticatedRequest {
  user: { id: string };
}

@ApiTags('Customer Rating')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class CustomerRatingController {
  constructor(private readonly ratings: CustomerRatingService) {}

  @Get(':orderId/customer-rating')
  @ApiOperation({ summary: "The provider's rating of this order's customer, or null" })
  async find(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Req() req: AuthenticatedRequest) {
    return (await this.ratings.find(orderId, req.user.id)) ?? { rating: null };
  }

  @Post(':orderId/customer-rating')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Provider rates the customer after a completed order (once)' })
  rate(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Body() dto: RateCustomerDto, @Req() req: AuthenticatedRequest) {
    return this.ratings.rate(orderId, dto, req.user.id);
  }
}
