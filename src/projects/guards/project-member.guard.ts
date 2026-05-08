import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectsService } from '../projects.service';

/**
 * Verifies that the authenticated user is a member of the project identified
 * by the `:projectId` route parameter.  Attaches `req.project` on success.
 */
@Injectable()
export class ProjectMemberGuard implements CanActivate {
  constructor(private readonly projects: ProjectsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const projectId = parseInt(req.params.projectId, 10);

    if (isNaN(projectId)) {
      throw new NotFoundException('Invalid projectId');
    }

    // Verify project exists
    const project = await this.projects.findOne(projectId);

    // Verify membership (req.user is set by JwtAuthGuard which must run first)
    const userId: number = req.user?.id;
    if (!userId) throw new ForbiddenException();

    const member = await this.projects.isMember(projectId, userId);
    if (!member) throw new ForbiddenException('Not a member of this project');

    // Attach for downstream use
    req.project = project;
    return true;
  }
}
