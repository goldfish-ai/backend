import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectMemberGuard } from './guards/project-member.guard';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpsertIntegrationDto } from './dto/upsert-integration.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  // -------------------------------------------------------
  // Project CRUD
  // -------------------------------------------------------

  @Post()
  create(@Req() req: any, @Body() dto: CreateProjectDto) {
    return this.projects.create(req.user.id, dto);
  }

  @Get()
  list(@Req() req: any) {
    return this.projects.findAllForUser(req.user.id);
  }

  @Get(':projectId')
  @UseGuards(ProjectMemberGuard)
  findOne(@Req() req: any) {
    return req.project;
  }

  @Patch(':projectId')
  @UseGuards(ProjectMemberGuard)
  update(@Param('projectId', ParseIntPipe) projectId: number, @Body() dto: UpdateProjectDto) {
    return this.projects.update(projectId, dto);
  }

  @Delete(':projectId')
  @UseGuards(ProjectMemberGuard)
  @HttpCode(200)
  async remove(@Param('projectId', ParseIntPipe) projectId: number) {
    await this.projects.remove(projectId);
    return { success: true };
  }

  // -------------------------------------------------------
  // Membership
  // -------------------------------------------------------

  @Get(':projectId/members')
  @UseGuards(ProjectMemberGuard)
  listMembers(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.projects.listMembers(projectId);
  }

  @Post(':projectId/members')
  @UseGuards(ProjectMemberGuard)
  addMember(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: AddMemberDto,
  ) {
    return this.projects.addMember(projectId, dto.userId);
  }

  @Delete(':projectId/members/:userId')
  @UseGuards(ProjectMemberGuard)
  @HttpCode(200)
  async removeMember(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    await this.projects.removeMember(projectId, userId);
    return { success: true };
  }

  // -------------------------------------------------------
  // Integration configs
  // -------------------------------------------------------

  @Get(':projectId/integrations')
  @UseGuards(ProjectMemberGuard)
  listIntegrations(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.projects.listIntegrations(projectId);
  }

  @Put(':projectId/integrations/:provider')
  @UseGuards(ProjectMemberGuard)
  upsertIntegration(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('provider') provider: string,
    @Body() dto: UpsertIntegrationDto,
  ) {
    return this.projects.upsertIntegration(projectId, provider, dto.config);
  }

  @Delete(':projectId/integrations/:provider')
  @UseGuards(ProjectMemberGuard)
  @HttpCode(200)
  async deleteIntegration(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('provider') provider: string,
  ) {
    await this.projects.deleteIntegration(projectId, provider);
    return { success: true };
  }
}
