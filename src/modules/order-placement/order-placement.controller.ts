import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminCustomOrderDto, AdminPlaceCartOrderDto, AdminPlaceOrderDto, CustomerCustomOrderDto, CustomerLookupQueryDto, PlaceCartOrderDto, PlaceOrderDto, QuoteCartDto, QuoteOrderDto } from './dto/place-order.dto';
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

  @Post('cart/quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Price of a cart (options of one main service), without placing an order' })
  quoteCart(@Body() dto: QuoteCartDto) {
    return this.placement.quoteCart(dto);
  }

  @Post('cart')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Place a cart as one order; the price is computed on the server' })
  placeCart(@Body() dto: PlaceCartOrderDto, @Req() req: AuthenticatedRequest) {
    return this.placement.placeCartOrder(dto, req.user);
  }

  @Post('custom')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Customer custom order: no price until the provider visits and the customer accepts a quote' })
  placeCustom(@Body() dto: CustomerCustomOrderDto, @Req() req: AuthenticatedRequest) {
    return this.placement.placeCustomerCustomOrder(dto, req.user);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Place an order; the price is computed on the server' })
  place(@Body() dto: PlaceOrderDto, @Req() req: AuthenticatedRequest) {
    return this.placement.placeOrder(dto, req.user);
  }

  @Get('admin/customer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: "ADMIN: who this number is, with the customer's name and last place, to fill the New order form" })
  lookupCustomer(@Query() query: CustomerLookupQueryDto) {
    return this.placement.lookupCustomer(query.phone);
  }

  @Post('admin/custom')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ADMIN: order a service that is not in the catalog (typed main service, sub-service, details, price)' })
  async placeCustomForCustomer(@Body() dto: AdminCustomOrderDto, @Req() req: AuthenticatedRequest) {
    return this.placement.placeCustomOrderForCustomer(dto, await this.placement.originFor(req.user));
  }

  @Post('admin/cart')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "ADMIN: order a cart of options for a customer by phone number (name optional)" })
  async placeCartForCustomer(@Body() dto: AdminPlaceCartOrderDto, @Req() req: AuthenticatedRequest) {
    return this.placement.placeCartOrderForCustomer(dto, await this.placement.originFor(req.user));
  }

  @Post('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ADMIN: place an order for a customer by phone number' })
  async placeForCustomer(@Body() dto: AdminPlaceOrderDto, @Req() req: AuthenticatedRequest) {
    return this.placement.placeOrderForCustomer(dto, await this.placement.originFor(req.user));
  }

  /*
   * A provider books for their own customer by phone number, with the same forms as an admin. The order is
   * theirs at once (never offered to other providers) and is charged by the admin's provider-order rule.
   * There is no customer lookup for providers: they must not read other people's names and addresses.
   */
  @Post('provider/custom')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PROVIDER)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'PROVIDER: own order for a service not in the catalog' })
  async providerPlaceCustom(@Body() dto: AdminCustomOrderDto, @Req() req: AuthenticatedRequest) {
    return this.placement.placeCustomOrderForCustomer(dto, await this.placement.originFor(req.user));
  }

  @Post('provider/cart')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PROVIDER)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'PROVIDER: own order of a cart for a customer by phone number' })
  async providerPlaceCart(@Body() dto: AdminPlaceCartOrderDto, @Req() req: AuthenticatedRequest) {
    return this.placement.placeCartOrderForCustomer(dto, await this.placement.originFor(req.user));
  }

  @Post('provider')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PROVIDER)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'PROVIDER: own order for a customer by phone number' })
  async providerPlace(@Body() dto: AdminPlaceOrderDto, @Req() req: AuthenticatedRequest) {
    return this.placement.placeOrderForCustomer(dto, await this.placement.originFor(req.user));
  }
}
