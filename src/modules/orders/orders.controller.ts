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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateCustomOrderDto } from './dto/create-custom-order.dto';
import {
  UpdateOrderDto,
  UpdateOrderStatusDto,
} from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) { }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create order' })
  create(@Body() data: CreateCustomOrderDto) {
    return this.ordersService.create(data);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all orders' })
  findAll() {
    return this.ordersService.findAll();
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
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ordersService.findOne(id);
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
  ) {
    return this.ordersService.updateStatus(id, data);
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
    return this.ordersService.acceptPrice(id)
  }

  @Patch(':id/reject-price')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject price' })
  rejectPrice(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ordersService.rejectPrice(id)
  }

}
