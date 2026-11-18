import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AssignOrderDto } from './dto/assign-order.dto';
import { OrderAssignmentService } from './order-assignment.service';

@ApiTags('Order assignment')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('admin/orders')
export class OrderAssignmentController {
  constructor(private readonly assignment: OrderAssignmentService) {}

  @Get(':orderId/assignable-providers')
  @ApiOperation({ summary: 'Providers an order that nobody accepted can be sent to, with what stops each one' })
  list(@Param('orderId', new ParseUUIDPipe()) orderId: string) {
    return this.assignment.listAssignable(orderId);
  }

  @Post(':orderId/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Offer the order to one provider, or assign it to them at once' })
  assign(@Req() req: { user: { id: string } }, @Param('orderId', new ParseUUIDPipe()) orderId: string, @Body() dto: AssignOrderDto) {
    return this.assignment.assign(req.user, orderId, dto.providerId, dto.mode);
  }
}
