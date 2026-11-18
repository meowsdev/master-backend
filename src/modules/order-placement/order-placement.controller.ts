import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminPlaceOrderDto, PlaceOrderDto, QuoteOrderDto } from './dto/place-order.dto';
import { OrderPlacementService } from './order-placement.service';

interface AuthenticatedRequest {
  user: { id: string; role: UserRole };
}

@ApiTags('Order placement')
@Controller('order-placement')
export class OrderPlacementController {
  constructor(private readonly placement: OrderPlacementService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Main services, their sub-services, prices, quantities and questions' })
  getCatalog() {
    return this.placement.getCatalog();
  }

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Price of a selection, without placing an order' })
  quote(@Body() dto: QuoteOrderDto) {
    return this.placement.quote(dto);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Place an order; the price is computed on the server' })
  place(@Body() dto: PlaceOrderDto, @Req() req: AuthenticatedRequest) {
    return this.placement.placeOrder(dto, req.user);
  }

  @Post('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ADMIN: place an order for a customer by phone number' })
  placeForCustomer(@Body() dto: AdminPlaceOrderDto) {
    return this.placement.placeOrderForCustomer(dto);
  }
}
