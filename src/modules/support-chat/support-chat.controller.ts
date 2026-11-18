import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OpenSupportThreadDto, SendSupportMessageDto, SupportDirectoryQueryDto } from './dto/support-chat.dto';
import { SupportChatService } from './support-chat.service';

interface AuthenticatedRequest {
  user: { id: string; role: string };
}

/*
 * Direct chat between platform staff and a provider or customer. Who may do what is decided in the
 * service (staff see every thread, a member only their own), never by the client.
 */
@ApiTags('Support chat')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('support-chat')
export class SupportChatController {
  constructor(private readonly support: SupportChatService) {}

  @Get('directory')
  @ApiOperation({ summary: 'Staff: providers or customers with their latest support message' })
  directory(@Req() req: AuthenticatedRequest, @Query() query: SupportDirectoryQueryDto) {
    return this.support.listDirectory(req.user, query.role, query.search);
  }

  @Post('threads')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Staff: open or start the thread with one provider or customer' })
  openForStaff(@Req() req: AuthenticatedRequest, @Body() dto: OpenSupportThreadDto) {
    return this.support.openThreadForStaff(req.user, dto.memberId);
  }

  @Get('me')
  @ApiOperation({ summary: 'Provider/customer: own support thread id and unread count' })
  mine(@Req() req: AuthenticatedRequest) {
    return this.support.getMine(req.user);
  }

  @Post('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provider/customer: open own support thread' })
  openOwn(@Req() req: AuthenticatedRequest) {
    return this.support.openOwnThread(req.user);
  }

  @Get('threads/:threadId/messages')
  messages(@Req() req: AuthenticatedRequest, @Param('threadId', new ParseUUIDPipe()) threadId: string) {
    return this.support.getMessages(req.user, threadId);
  }

  @Post('threads/:threadId/messages')
  send(@Req() req: AuthenticatedRequest, @Param('threadId', new ParseUUIDPipe()) threadId: string, @Body() dto: SendSupportMessageDto) {
    return this.support.sendMessage(req.user, threadId, dto.text);
  }

  @Post('threads/:threadId/read')
  @HttpCode(HttpStatus.OK)
  read(@Req() req: AuthenticatedRequest, @Param('threadId', new ParseUUIDPipe()) threadId: string) {
    return this.support.markRead(req.user, threadId);
  }
}
