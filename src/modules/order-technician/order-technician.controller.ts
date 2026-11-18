import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SetOrderTechnicianDto } from './dto/set-order-technician.dto';
import { OrderTechnicianService } from './order-technician.service';

type AuthenticatedRequest = { user: { id: string; role: UserRole } };

@ApiTags('Order technician')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PROVIDER, UserRole.ADMIN)
@Controller('orders/:orderId/technician')
export class OrderTechnicianController {
  constructor(private readonly technicians: OrderTechnicianService) {}

  @Get()
  @ApiOperation({ summary: "The provider's own technicians that can be put on this order" })
  list(@Req() req: AuthenticatedRequest, @Param('orderId', new ParseUUIDPipe()) orderId: string) {
    return this.technicians.listForOrder(req.user, orderId);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Put one of the provider\'s technicians on this order, or take the technician off (null)' })
  set(@Req() req: AuthenticatedRequest, @Param('orderId', new ParseUUIDPipe()) orderId: string, @Body() dto: SetOrderTechnicianDto) {
    return this.technicians.setTechnician(req.user, orderId, dto.technicianId);
  }
}
