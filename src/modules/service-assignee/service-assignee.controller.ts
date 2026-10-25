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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateServiceAssigneeDto,
  SyncMySkillsDto,
  UpdateServiceAssigneeDto,
} from './dto/service-assignee.dto';
import { ServiceAssigneeService } from './service-assignee.service';

interface AuthenticatedRequest {
  user: {
    id: string;
  };
}

@ApiTags('Service Assignee')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('service-assignee')
export class ServiceAssigneeController {
  constructor(
    private readonly serviceAssigneeService: ServiceAssigneeService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Assign a user to a service' })
  create(@Body() data: CreateServiceAssigneeDto) {
    return this.serviceAssigneeService.create(data);
  }

  @Post('sync-my-skills')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sync active skills for current authenticated provider' })
  syncMySkills(
    @Req() req: AuthenticatedRequest,
    @Body() data: SyncMySkillsDto,
  ) {
    return this.serviceAssigneeService.syncMySkills(req.user.id, data.serviceIds || []);
  }

  @Get('my-skills')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get assigned skills for current authenticated provider' })
  getMySkills(@Req() req: AuthenticatedRequest) {
    return this.serviceAssigneeService.findByUser(req.user.id);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all service assignees' })
  findAll() {
    return this.serviceAssigneeService.findAll();
  }

  @Get('service/:serviceId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get assignees by service' })
  findByService(@Param('serviceId', new ParseUUIDPipe()) serviceId: string) {
    return this.serviceAssigneeService.findByService(serviceId);
  }

  @Get('user/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get assigned services by user' })
  findByUser(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.serviceAssigneeService.findByUser(userId);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get service assignee by id' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.serviceAssigneeService.findOne(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update service assignee' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() data: UpdateServiceAssigneeDto,
  ) {
    return this.serviceAssigneeService.update(id, data);
  }

  @Patch(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate service assignee' })
  deactivate(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.serviceAssigneeService.deactivate(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete service assignee' })
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.serviceAssigneeService.remove(id);
  }
}
