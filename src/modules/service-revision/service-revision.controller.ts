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
import {
  CreateServiceRevisionDto,
  PostRevisionFeedbackeDto,
  UpdateServiceRevisionDto,
} from './dto/service-revision.dto';
import { ServiceRevisionService } from './service-revision.service';

@ApiTags('Service Revision')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('service-revision')
export class ServiceRevisionController {
  constructor(
    private readonly serviceRevisionService: ServiceRevisionService,
  ) { }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create service revision' })
  create(@Body() data: CreateServiceRevisionDto) {
    return this.serviceRevisionService.create(data);
  }

  @Get()
  findAll() {
    return this.serviceRevisionService.findAll();
  }

  @Get('order/:orderId')
  findByOrder(@Param('orderId', new ParseUUIDPipe()) orderId: string) {
    return this.serviceRevisionService.findByOrder(orderId);
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.serviceRevisionService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() data: UpdateServiceRevisionDto,
  ) {
    return this.serviceRevisionService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.serviceRevisionService.remove(id);
  }

  @Post(':id/feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit post-revision feedback (Continue with provider: Yes/No)'
  })
  postFeedback(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() data: PostRevisionFeedbackeDto,
  ) {
    return this.serviceRevisionService.postRevisionFeedback(id, data.continueWithProvider)
  }

}
