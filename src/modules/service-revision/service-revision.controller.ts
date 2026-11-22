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
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  CreateServiceRevisionDto,
  PostRevisionFeedbackeDto,
  UpdateServiceRevisionDto,
} from './dto/service-revision.dto';
import { ServiceRevisionService } from './service-revision.service';

interface AuthenticatedRequest {
  user: { id: string; role: UserRole };
}

@ApiTags('Service Revision')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('service-revision')
export class ServiceRevisionController {
  constructor(
    private readonly serviceRevisionService: ServiceRevisionService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a completed order back for revision (7-day warranty). Customer of the order or admin.' })
  create(@Body() data: CreateServiceRevisionDto, @Req() req: AuthenticatedRequest) {
    return this.serviceRevisionService.create(data, req.user);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.serviceRevisionService.findAll();
  }

  @Get('order/:orderId')
  findByOrder(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Req() req: AuthenticatedRequest) {
    return this.serviceRevisionService.findByOrder(orderId, req.user);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.serviceRevisionService.findOne(id, req.user);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() data: UpdateServiceRevisionDto,
  ) {
    return this.serviceRevisionService.update(id, data);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.serviceRevisionService.remove(id);
  }

  @Post(':id/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit post-revision feedback (Continue with provider: Yes/No)',
  })
  postFeedback(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() data: PostRevisionFeedbackeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.serviceRevisionService.postRevisionFeedback(
      id,
      data.continueWithProvider,
      req.user,
    );
  }
}
