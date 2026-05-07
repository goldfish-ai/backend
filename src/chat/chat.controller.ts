import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatService } from './chat.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateMessageDto } from './dto/create-message.dto';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('sessions')
  createSession(@Req() req: any, @Body() dto: CreateSessionDto) {
    return this.chat.createSession(req.user.id, dto);
  }

  @Get('sessions')
  listSessions(@Req() req: any) {
    return this.chat.listSessions(req.user.id);
  }

  @Get('sessions/:id/messages')
  getMessages(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.chat.getMessages(req.user.id, id);
  }

  @Post('sessions/:id/messages')
  addMessage(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateMessageDto,
  ) {
    return this.chat.addMessage(req.user.id, id, dto);
  }

  @Delete('sessions/:id')
  deleteSession(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.chat.deleteSession(req.user.id, id);
  }
}
