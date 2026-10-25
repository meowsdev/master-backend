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
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateCustomOrderDto } from './dto/create-custom-order.dto';
import {
  UpdateOrderDto,
  UpdateOrderStatusDto,
} from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

interface AuthenticatedRequest {
  user: {
    id: string;
    role: UserRole;
  };
}

@ApiTags('Orders')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create order with auto skill-matched provider' })
  create(
    @Body() data: CreateCustomOrderDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ordersService.create(data, req.user);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get orders filtered by user role' })
  findAll(@Req() req: AuthenticatedRequest & { headers: Record<string, string | undefined> }) {
    const activeRole = req.headers['x-active-role'] as UserRole | undefined;
    return this.ordersService.findAllForUser(req.user, activeRole);
  }

  @Get('provider/:providerId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get orders by provider profile' })
  findByProvider(@Param('providerId', new ParseUUIDPipe()) providerId: string) {
    return this.ordersService.findByProvider(providerId);
  }

  @Get('customer/:customerId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get orders by customer profile' })
  findByCustomer(@Param('customerId', new ParseUUIDPipe()) customerId: string) {
    return this.ordersService.findByCustomer(customerId);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get order by id' })
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ordersService.findOneForUser(id, req.user);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update order' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() data: UpdateOrderDto,
  ) {
    return this.ordersService.update(id, data);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update order status' })
  updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() data: UpdateOrderStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.ordersService.updateStatusForUser(id, data, req.user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete order' })
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ordersService.remove(id);
  }

  @Patch(':id/accept-price')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept price' })
  acceptPrice(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ordersService.acceptPrice(id);
  }

  @Patch(':id/reject-price')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject price' })
  rejectPrice(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ordersService.rejectPrice(id);
  }
}
