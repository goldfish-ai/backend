import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";
import axios from "axios";
import { DocumentsService } from "../documents/documents.service";
import { ProjectsService } from "../projects/projects.service";

@Injectable()
export class GithubWebhookService {
  private readonly logger = new Logger(GithubWebhookService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly documents: DocumentsService,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * Resolves the GitHub PAT for a project from DB config.
   * Throws if no token found — env fallback is intentionally removed.
   */
  private async resolveToken(projectId: number): Promise<string> {
    const integration = await this.projects.getIntegration(projectId, 'github');
    const token = integration?.config?.token;
    if (!token) throw new BadRequestException('GitHub token not configured for this project');
    return token;
  }

  /**
   * Resolves the webhook secret for a project from DB config.
   * Returns undefined if not configured (signature check is skipped).
   */
  private async resolveWebhookSecret(projectId: number): Promise<string | undefined> {
    const integration = await this.projects.getIntegration(projectId, 'github');
    return integration?.config?.webhookSecret;
  }

  private authHeaders(token: string, accept: string = "application/vnd.github.v3+json") {
    return {
      Accept: accept,
      Authorization: `Bearer ${token}`,
    };
  }

  async getPullRequestDiff(
    owner: string,
    repo: string,
    pullNumber: number,
    token: string,
  ): Promise<string> {
    try {
      const { data } = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`,
        { headers: this.authHeaders(token, "application/vnd.github.v3.diff") },
      );
      return data as string;
    } catch (err) {
      this.logger.warn(
        `Could not fetch diff for ${owner}/${repo}#${pullNumber}: ${(err as any)?.message}`,
      );
      return "";
    }
  }

  async getPullRequestCommits(
    owner: string,
    repo: string,
    pullNumber: number,
    token: string,
  ): Promise<any[]> {
    try {
      const { data } = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/commits`,
        { headers: this.authHeaders(token) },
      );
      return data;
    } catch (err) {
      this.logger.warn(
        `Could not fetch commits for ${owner}/${repo}#${pullNumber}: ${(err as any)?.message}`,
      );
      return [];
    }
  }

  async getCommitDiff(
    owner: string,
    repo: string,
    ref: string,
    token: string,
  ): Promise<string> {
    try {
      const { data } = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/commits/${ref}`,
        { headers: this.authHeaders(token, "application/vnd.github.v3.diff") },
      );
      return data as string;
    } catch (err) {
      this.logger.warn(
        `Could not fetch diff for commit ${owner}/${repo}@${ref}: ${(err as any)?.message}`,
      );
      return "";
    }
  }

  async verify(rawBody: Buffer, signature: string, projectId: number): Promise<boolean> {
    const secret = await this.resolveWebhookSecret(projectId);
    if (!secret) return true; // skip verification if not configured in DB
    const expected = `sha256=${crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex")}`;
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature),
    );
  }

  async handlePush(payload: any, projectId = 1): Promise<number[]> {
    const commits: any[] = payload.commits ?? [];
    const repo = payload.repository?.full_name ?? "unknown";
    const [owner, repoName] = repo.split("/");
    const stored: number[] = [];
    const token = await this.resolveToken(projectId);

    for (const commit of commits) {
      const diff = owner && repoName ? await this.getCommitDiff(owner, repoName, commit.id, token) : "";

      const contentParts = [
        commit.message,
        `Author: ${commit.author.name} <${commit.author.email}>`,
        `SHA: ${commit.id}`,
        `URL: ${commit.url}`,
        commit.added?.length ? `Added: ${commit.added.join(", ")}` : "",
        commit.modified?.length
          ? `Modified: ${commit.modified.join(", ")}`
          : "",
        commit.removed?.length ? `Removed: ${commit.removed.join(", ")}` : "",
      ].filter(Boolean);

      if (diff) {
        contentParts.push("", "## Code Diff", "```diff", diff, "```");
      }

      const doc = await this.documents.create({
        title: `[Commit] ${commit.message.split("\n")[0].slice(0, 120)}`,
        content: contentParts.join("\n"),
        source: "github",
        author: commit.author?.name ?? null,
        dataCreatedAt: commit.timestamp ?? null,
        metadata: { sha: commit.id, repo, type: "commit", auto: true },
      }, projectId);
      stored.push(doc.id);
      this.logger.log(
        `Auto-embedded commit ${commit.id.slice(0, 8)} from ${repo}`,
      );
    }

    return stored;
  }

  async handlePullRequest(payload: any, projectId = 1): Promise<number | null> {
    const action: string = payload.action;
    if (!["opened", "edited", "closed", "synchronize"].includes(action))
      return null;

    const pr = payload.pull_request;
    const repo = payload.repository?.full_name ?? "unknown";
    const [owner, repoName] = repo.split("/");
    const token = await this.resolveToken(projectId);

    const diff = await this.getPullRequestDiff(owner, repoName, pr.number, token);
    const commits = await this.getPullRequestCommits(owner, repoName, pr.number, token);

    const contentParts = [
      `PR #${pr.number}: ${pr.title}`,
      `Action: ${action}`,
      `State: ${pr.state}`,
      `Author: ${pr.user.login}`,
      `Branch: ${pr.head.ref} → ${pr.base.ref}`,
      `Merged: ${pr.merged ?? false}`,
      pr.body || "(no description)",
      `URL: ${pr.html_url}`,
    ];

    if (commits && commits.length > 0) {
      contentParts.push("", "## Commits");
      for (const c of commits) {
        const msg = c.commit?.message ?? "No message";
        const author = c.commit?.author?.name ?? "Unknown";
        const sha = c.sha?.substring(0, 7) ?? "Unknown";
        contentParts.push(`- ${sha} ${author}: ${msg.split('\n')[0]}`);
      }
    }

    if (diff) {
      contentParts.push("", "## Code Diff", "```diff", diff, "```");
    }

    const doc = await this.documents.create({
      title: `[PR #${pr.number}] ${pr.title}`,
      content: contentParts.join("\n"),
      source: "github",
      author: pr.user?.login ?? null,
      dataCreatedAt: pr.created_at ?? null,
      metadata: {
        pr_number: pr.number,
        repo,
        type: "pull_request",
        action,
        auto: true,
      },
    }, projectId);

    this.logger.log(`Auto-embedded PR #${pr.number} (${action}) from ${repo}`);
    return doc.id;
  }

  async handleIssueComment(payload: any, projectId = 1): Promise<number | null> {
    if (payload.action !== "created") return null;

    const comment = payload.comment;
    const issue = payload.issue;
    const repo = payload.repository?.full_name ?? "unknown";
    const isPr = !!issue.pull_request;

    const doc = await this.documents.create({
      title: `[Comment on ${isPr ? "PR" : "Issue"} #${issue.number}] ${issue.title}`,
      content: [
        `# Comment on ${isPr ? "PR" : "Issue"} #${issue.number}: ${issue.title}`,
        `**Author:** ${comment.user.login}`,
        "",
        comment.body,
        "",
        `URL: ${comment.html_url}`,
      ].join("\n"),
      source: "github",
      author: comment.user?.login ?? null,
      dataCreatedAt: comment.created_at ?? null,
      metadata: {
        issue_number: issue.number,
        comment_id: comment.id,
        repo,
        type: "issue_comment",
        is_pr: isPr,
        auto: true,
      },
    }, projectId);

    this.logger.log(
      `Auto-embedded issue_comment by ${comment.user.login} on #${issue.number} from ${repo}`,
    );
    return doc.id;
  }
}
