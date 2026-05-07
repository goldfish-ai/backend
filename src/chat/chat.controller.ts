import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatService } from './chat.service';
import { TimelineService } from './timeline.service';
import { ExpertsService } from './experts.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateMessageDto } from './dto/create-message.dto';

function csvToArray(v?: string): string[] | undefined {
  if (!v) return undefined;
  const arr = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? arr : undefined;
}

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly timeline: TimelineService,
    private readonly experts: ExpertsService,
  ) {}

  @Post('sessions')
  createSession(@Req() req: any, @Body() dto: CreateSessionDto) {
    return this.chat.createSession(req.user.id, dto);
  }

  @Get('sessions')
  listSessions(@Req() req: any) {
    return this.chat.listSessions(req.user.id);
  }

  /**
   * Sidebar list — all sessions with message count + last message preview.
   * GET /chat/sessions/list
   */
  @Get('sessions/list')
  listSessionsForUI(@Req() req: any) {
    return this.chat.listSessionsForUI(req.user.id);
  }

  /**
   * Paired request/response turns for one session.
   * GET /chat/sessions/:id/history
   */
  @Get('sessions/:id/history')
  getSessionHistory(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.chat.getSessionHistory(req.user.id, id);
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

  /**
   * Drill into a single citation: returns the full thread / PR / issue chain.
   * sourceIndex is the position of the citation in the assistant message's
   * `sources` array.
   */
  @Get('sessions/:sid/messages/:mid/sources/:idx')
  expandSource(
    @Req() req: any,
    @Param('sid', ParseIntPipe) sid: number,
    @Param('mid', ParseIntPipe) mid: number,
    @Param('idx', ParseIntPipe) idx: number,
  ) {
    return this.chat.expandSource(req.user.id, sid, mid, idx);
  }

  /**
   * Memory Timeline — chronological event feed with module/source/kind filters
   * and facet counts. No LLM call.
   */
  @Get('timeline')
  getTimeline(
    @Query('modules') modules?: string,
    @Query('sources') sources?: string,
    @Query('kinds') kinds?: string,
    @Query('authors') authors?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.timeline.getTimeline({
      modules: csvToArray(modules),
      sources: csvToArray(sources),
      kinds: csvToArray(kinds),
      authors: csvToArray(authors),
      dateFrom,
      dateTo,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  /**
   * Expert Finder — ranks team members by semantic relevance × recency on a topic.
   */
  @Get('experts')
  getExperts(
    @Query('topic') topic: string,
    @Query('modules') modules?: string,
    @Query('sources') sources?: string,
    @Query('limit') limit?: string,
  ) {
    return this.experts.findExperts({
      topic,
      modules: csvToArray(modules),
      sources: csvToArray(sources),
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
