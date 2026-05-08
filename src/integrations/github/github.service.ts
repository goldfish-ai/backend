import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosResponse } from 'axios';
import { DocumentsService } from '../../documents/documents.service';
import { ProjectsService } from '../../projects/projects.service';
import { GithubIngestDto } from './dto/github-ingest.dto';

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly documents: DocumentsService,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * Resolves the GitHub PAT for a project.
   * Priority: explicit override token > DB config.token.
   * Throws if no token found — env fallback is intentionally removed.
   */
  private async resolveToken(projectId: number, explicitToken?: string): Promise<string> {
    if (explicitToken) return explicitToken;
    const integration = await this.projects.getIntegration(projectId, 'github');
    const token = integration?.config?.token;
    if (!token) throw new BadRequestException('GitHub token not configured for this project');
    return token;
  }

  private headers(token: string) {
    return {
      Accept: 'application/vnd.github.v3+json',
      Authorization: `Bearer ${token}`,
    };
  }

  /**
   * Check the X-RateLimit-Remaining header. Logs a warning when low.
   * Returns false if the limit is fully exhausted (0 remaining).
   */
  private checkRateLimit(response: AxiosResponse): boolean {
    const remaining = parseInt(response.headers['x-ratelimit-remaining'] ?? '1', 10);
    const reset = parseInt(response.headers['x-ratelimit-reset'] ?? '0', 10);
    if (remaining === 0) {
      const resetAt = new Date(reset * 1000).toISOString();
      this.logger.warn(
        `GitHub API rate limit exhausted. Resets at ${resetAt}. Stopping early.`,
      );
      return false;
    }
    if (remaining < 100) {
      this.logger.warn(`GitHub API rate limit low: ${remaining} requests remaining.`);
    }
    return true;
  }

  async ingest(dto: GithubIngestDto, projectId = 1): Promise<{ stored: number[]; skipped: number }> {
    const type = dto.type ?? 'all';
    const stored: number[] = [];
    const token = await this.resolveToken(projectId, dto.token);

    if (type === 'commits' || type === 'all') {
      const ids = await this.ingestCommits(dto.owner, dto.repo, dto.limit, dto.branch, token, projectId);
      stored.push(...ids);
    }
    if (type === 'pulls' || type === 'all') {
      const ids = await this.ingestPulls(dto.owner, dto.repo, dto.limit, dto.state ?? 'all', token, projectId);
      stored.push(...ids);
    }
    if (type === 'issues' || type === 'all') {
      const ids = await this.ingestIssues(dto.owner, dto.repo, dto.limit, dto.state ?? 'all', token, projectId);
      stored.push(...ids);
    }

    if (type === 'files' || type === 'all') {
      const ids = await this.ingestFiles(dto.owner, dto.repo, dto.branch, dto.filePaths, token, projectId);
      stored.push(...ids);
    }

    return { stored, skipped: 0 };
  }

  private async ingestCommits(
    owner: string,
    repo: string,
    limit?: number,
    branch?: string,
    token: string = '',
    projectId = 1,
  ): Promise<number[]> {
    const stored: number[] = [];
    let page = 1;
    const repoFull = `${owner}/${repo}`;

    this.logger.log(`Fetching commits for ${repoFull} (limit=${limit ?? 'all'})`);

    while (true) {
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/commits`,
        {
          headers: this.headers(token),
          params: { per_page: 100, page, ...(branch ? { sha: branch } : {}) },
        },
      );

      const data: any[] = response.data;
      if (!data.length) break;

      for (const c of data) {
        const doc = await this.documents.create({
          title: `[Commit] ${c.commit.message.split('\n')[0].slice(0, 120)}`,
          content: [
            c.commit.message,
            `Author: ${c.commit.author.name} <${c.commit.author.email}>`,
            `SHA: ${c.sha}`,
            `URL: ${c.html_url}`,
          ].join('\n'),
          source: 'github',
          author: c.commit.author.name || c.author?.login || null,
          dataCreatedAt: c.commit.author.date ?? null,
          metadata: { sha: c.sha, repo: repoFull, type: 'commit' },
        }, projectId);
        stored.push(doc.id);

        if (limit !== undefined && stored.length >= limit) break;
      }

      if (limit !== undefined && stored.length >= limit) break;
      if (!this.checkRateLimit(response)) break;
      if (data.length < 100) break;

      page++;
    }

    this.logger.log(`Commits for ${repoFull}: ${stored.length} stored`);
    return stored;
  }

  private async ingestPulls(
    owner: string,
    repo: string,
    limit?: number,
    state = 'all',
    token: string = '',
    projectId = 1,
  ): Promise<number[]> {
    const stored: number[] = [];
    let page = 1;
    const repoFull = `${owner}/${repo}`;

    this.logger.log(`Fetching pull requests for ${repoFull} (state=${state}, limit=${limit ?? 'all'})`);

    while (true) {
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/pulls`,
        {
          headers: this.headers(token),
          params: { per_page: 100, page, state },
        },
      );

      const data: any[] = response.data;
      if (!data.length) break;

      for (const pr of data) {
        const doc = await this.documents.create({
          title: `[PR #${pr.number}] ${pr.title}`,
          content: [
            `PR #${pr.number}: ${pr.title}`,
            `State: ${pr.state}`,
            `Author: ${pr.user.login}`,
            `Branch: ${pr.head.ref} → ${pr.base.ref}`,
            pr.body || '(no description)',
            `URL: ${pr.html_url}`,
          ].join('\n'),
          source: 'github',
          author: pr.user?.login ?? null,
          dataCreatedAt: pr.created_at ?? null,
          metadata: { pr_number: pr.number, repo: repoFull, type: 'pull_request', state: pr.state },
        }, projectId);
        stored.push(doc.id);

        if (limit !== undefined && stored.length >= limit) break;
      }

      if (limit !== undefined && stored.length >= limit) break;
      if (!this.checkRateLimit(response)) break;
      if (data.length < 100) break;

      page++;
    }

    this.logger.log(`Pull requests for ${repoFull}: ${stored.length} stored`);
    return stored;
  }

  private async ingestIssues(
    owner: string,
    repo: string,
    limit?: number,
    state = 'all',
    token: string = '',
    projectId = 1,
  ): Promise<number[]> {
    const stored: number[] = [];
    let page = 1;
    const repoFull = `${owner}/${repo}`;

    this.logger.log(`Fetching issues for ${repoFull} (state=${state}, limit=${limit ?? 'all'})`);

    while (true) {
      const response = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/issues`,
        {
          headers: this.headers(token),
          params: { per_page: 100, page, state },
        },
      );

      const data: any[] = response.data;
      if (!data.length) break;

      // GitHub issues endpoint also returns PRs — filter them out
      const issues = data.filter((i: any) => !i.pull_request);

      for (const issue of issues) {
        const doc = await this.documents.create({
          title: `[Issue #${issue.number}] ${issue.title}`,
          content: [
            `Issue #${issue.number}: ${issue.title}`,
            `State: ${issue.state}`,
            `Author: ${issue.user.login}`,
            `Labels: ${issue.labels.map((l: any) => l.name).join(', ') || 'none'}`,
            issue.body || '(no description)',
            `URL: ${issue.html_url}`,
          ].join('\n'),
          source: 'github',
          author: issue.user?.login ?? null,
          dataCreatedAt: issue.created_at ?? null,
          metadata: { issue_number: issue.number, repo: repoFull, type: 'issue', state: issue.state },
        }, projectId);
        stored.push(doc.id);

        if (limit !== undefined && stored.length >= limit) break;
      }

      if (limit !== undefined && stored.length >= limit) break;
      if (!this.checkRateLimit(response)) break;
      if (data.length < 100) break;

      page++;
    }

    this.logger.log(`Issues for ${repoFull}: ${stored.length} stored`);
    return stored;
  }

  /**
   * Strip markdown syntax from text so the embedding reflects clean prose
   * rather than structural noise (headers, code blocks, badges, URLs, etc.)
   */
  private stripMarkdown(text: string): string {
    return text
      // Remove code blocks (fenced)
      .replace(/```[\s\S]*?```/g, '')
      // Remove inline code
      .replace(/`[^`]*`/g, '')
      // Remove image/badge syntax ![alt](url)
      .replace(/!\[.*?\]\(.*?\)/g, '')
      // Replace links [text](url) with just the text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Remove HTML tags
      .replace(/<[^>]+>/g, '')
      // Remove markdown headings markers (keep the text)
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bold/italic markers
      .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2')
      // Remove horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, '')
      // Remove blockquote markers
      .replace(/^>\s*/gm, '')
      // Remove bare URLs
      .replace(/https?:\/\/\S+/g, '')
      // Collapse multiple blank lines into one
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private async ingestFiles(
    owner: string,
    repo: string,
    branch?: string,
    filePaths?: string[],
    token: string = '',
    projectId = 1,
  ): Promise<number[]> {
    const stored: number[] = [];
    const repoFull = `${owner}/${repo}`;
    const ref = branch ?? 'HEAD';

    // File extensions / names considered documentation
    const DOC_EXTENSIONS = ['.md', '.mdx', '.txt', '.rst'];
    const DOC_FILENAMES = ['README', 'CONTRIBUTING', 'CHANGELOG', 'ARCHITECTURE', 'OVERVIEW', 'DESIGN'];

    const isDocFile = (path: string): boolean => {
      const lower = path.toLowerCase();
      if (DOC_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
      const basename = lower.split('/').pop() ?? '';
      return DOC_FILENAMES.some((n) => basename.startsWith(n.toLowerCase()));
    };

    this.logger.log(`Fetching file tree for ${repoFull} (ref=${ref})`);

    // Get full recursive file tree
    const treeRes = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}`,
      {
        headers: this.headers(token),
        params: { recursive: '1' },
      },
    );

    const allBlobs: { path: string; sha: string }[] = (treeRes.data.tree ?? []).filter(
      (node: any) => node.type === 'blob',
    );

    // Filter to target files
    const targets = filePaths
      ? allBlobs.filter((f) => filePaths.includes(f.path))
      : allBlobs.filter((f) => isDocFile(f.path));

    this.logger.log(`Found ${targets.length} doc files to ingest in ${repoFull}`);

    for (const file of targets) {
      try {
        const contentRes = await axios.get(
          `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`,
          {
            headers: this.headers(token),
            params: { ref },
          },
        );

        const raw = contentRes.data;
        if (!raw.content) continue;

        // GitHub returns base64-encoded content with newlines — decode it
        const rawContent = Buffer.from(raw.content.replace(/\n/g, ''), 'base64').toString('utf-8');
        if (!rawContent.trim()) continue;

        // Strip markdown syntax so embeddings reflect clean prose, not structural noise
        const content = this.stripMarkdown(rawContent);
        if (!content.trim()) continue;

        const filename = file.path.split('/').pop() ?? file.path;

        const doc = await this.documents.create({
          title: `[Doc] ${file.path}`,
          content: `# ${filename}\n\n${content}`,
          source: 'github',
          author: undefined,
          metadata: { path: file.path, repo: repoFull, type: 'file', sha: file.sha },
        }, projectId);
        stored.push(doc.id);

        if (!this.checkRateLimit(contentRes)) break;
      } catch (err: any) {
        this.logger.warn(`Failed to fetch ${file.path}: ${err?.message}`);
      }
    }

    this.logger.log(`Files for ${repoFull}: ${stored.length} stored`);
    return stored;
  }
}
