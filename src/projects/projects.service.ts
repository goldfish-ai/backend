import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import axios from 'axios';
import { DatabaseService } from '../database/database.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

export interface Project {
  id: number;
  name: string;
  created_at: Date;
}

export interface ProjectIntegration {
  id: number;
  project_id: number;
  provider: string;
  config: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class ProjectsService {
  constructor(private readonly db: DatabaseService) {}

  // -------------------------------------------------------
  // Project CRUD
  // -------------------------------------------------------

  async create(userId: number, dto: CreateProjectDto): Promise<Project> {
    const client = await this.db.getPool().connect();
    try {
      await client.query('BEGIN');
      const projRes = await client.query<Project>(
        `INSERT INTO projects (name) VALUES ($1) RETURNING *`,
        [dto.name],
      );
      const project = projRes.rows[0];
      // Creator is automatically a member
      await client.query(
        `INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)`,
        [project.id, userId],
      );
      await client.query('COMMIT');
      return project;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findAllForUser(userId: number): Promise<Project[]> {
    const res = await this.db.query<Project>(
      `SELECT p.* FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = $1
       ORDER BY p.created_at ASC`,
      [userId],
    );
    return res.rows;
  }

  async findOne(projectId: number): Promise<Project> {
    const res = await this.db.query<Project>(
      `SELECT * FROM projects WHERE id = $1`,
      [projectId],
    );
    if (!res.rows.length) throw new NotFoundException(`Project ${projectId} not found`);
    return res.rows[0];
  }

  async update(projectId: number, dto: UpdateProjectDto): Promise<Project> {
    const res = await this.db.query<Project>(
      `UPDATE projects SET name = COALESCE($1, name) WHERE id = $2 RETURNING *`,
      [dto.name ?? null, projectId],
    );
    if (!res.rows.length) throw new NotFoundException(`Project ${projectId} not found`);
    return res.rows[0];
  }

  async remove(projectId: number): Promise<void> {
    const res = await this.db.query(
      `DELETE FROM projects WHERE id = $1`,
      [projectId],
    );
    if (res.rowCount === 0) throw new NotFoundException(`Project ${projectId} not found`);
  }

  // -------------------------------------------------------
  // Membership
  // -------------------------------------------------------

  async isMember(projectId: number, userId: number): Promise<boolean> {
    const res = await this.db.query(
      `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId],
    );
    return res.rows.length > 0;
  }

  async addMember(projectId: number, userId: number): Promise<void> {
    await this.db.query(
      `INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [projectId, userId],
    );
  }

  async removeMember(projectId: number, userId: number): Promise<void> {
    await this.db.query(
      `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId],
    );
  }

  async listMembers(projectId: number) {
    const res = await this.db.query(
      `SELECT u.id, u.email, u.name, pm.created_at AS joined_at
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1
       ORDER BY pm.created_at ASC`,
      [projectId],
    );
    return res.rows;
  }

  // -------------------------------------------------------
  // Integration configs
  // -------------------------------------------------------

  async listIntegrations(projectId: number): Promise<ProjectIntegration[]> {
    const res = await this.db.query<ProjectIntegration>(
      `SELECT * FROM project_integrations WHERE project_id = $1 ORDER BY provider`,
      [projectId],
    );
    return res.rows;
  }

  async getIntegration(
    projectId: number,
    provider: string,
  ): Promise<ProjectIntegration | null> {
    const res = await this.db.query<ProjectIntegration>(
      `SELECT * FROM project_integrations WHERE project_id = $1 AND provider = $2`,
      [projectId, provider],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Validates a GitHub PAT by calling GET /user on the GitHub API.
   * Throws UnprocessableEntityException if the token is invalid.
   * Returns the authenticated GitHub login on success.
   */
  async validateGithubToken(token: string): Promise<{ login: string; scopes: string[] }> {
    try {
      const { data, headers } = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });
      const scopes = (headers['x-oauth-scopes'] ?? '')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
      return { login: data.login, scopes };
    } catch {
      throw new UnprocessableEntityException('Invalid GitHub token');
    }
  }

  async upsertIntegration(
    projectId: number,
    provider: string,
    config: Record<string, any>,
  ): Promise<ProjectIntegration> {
    // Validate GitHub token before saving
    if (provider === 'github' && config.token) {
      await this.validateGithubToken(config.token);
    }

    const res = await this.db.query<ProjectIntegration>(
      `INSERT INTO project_integrations (project_id, provider, config)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, provider)
       DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
       RETURNING *`,
      [projectId, provider, config],
    );
    return res.rows[0];
  }

  async deleteIntegration(projectId: number, provider: string): Promise<void> {
    await this.db.query(
      `DELETE FROM project_integrations WHERE project_id = $1 AND provider = $2`,
      [projectId, provider],
    );
  }
}
