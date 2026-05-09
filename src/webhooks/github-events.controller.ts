import {
  Body,
  Controller,
  Headers,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  RawBodyRequest,
  Req,
  Res,
} from "@nestjs/common";
import { Request, Response } from "express";
import { GithubWebhookService } from "./github-webhook.service";

/** Project-scoped route: POST /api/projects/:projectId/webhooks/github */
@Controller("projects/:projectId/webhooks/github")
export class GithubEventsProjectController {
  private readonly logger = new Logger(GithubEventsProjectController.name);

  constructor(private readonly github: GithubWebhookService) {}

  @Post()
  async handleWebhook(
    @Param("projectId", ParseIntPipe) projectId: number,
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-hub-signature-256") sig: string,
    @Headers("x-github-event") event: string,
    @Body() body: any,
    @Res() res: Response,
  ) {
    const rawBody = req.rawBody;
    if (rawBody && sig && !await this.github.verify(rawBody, sig, projectId)) {
      res.status(HttpStatus.UNAUTHORIZED).json({ error: "Invalid signature" });
      return;
    }

    res.status(HttpStatus.OK).send("Received");

    this.processEvent(event, body, projectId).catch((err) =>
      this.logger.error(`Error processing GitHub event '${event}'`, err),
    );
  }

  private async processEvent(event: string, payload: any, projectId: number): Promise<void> {
    this.logger.log(`Processing GitHub event: ${event} for project ${projectId}`);
    if (
      event === "pull_request" &&
      ["opened", "closed", "synchronize"].includes(payload.action)
    ) {
      await this.github.handlePullRequest(payload, projectId);
    } else if (event === "issue_comment" && payload.action === "created") {
      await this.github.handleIssueComment(payload, projectId);
    } else if (event === "push") {
      await this.github.handlePush(payload, projectId);
    } else {
      this.logger.log(
        `Unhandled GitHub event type: ${event} (action: ${payload.action ?? "n/a"})`,
      );
    }
  }
}

/** Legacy shim: POST /api/github/events → routes to project 1 */
@Controller("github/events")
export class GithubEventsController {
  private readonly logger = new Logger(GithubEventsController.name);

  constructor(private readonly github: GithubWebhookService) {}

  @Post()
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-hub-signature-256") sig: string,
    @Headers("x-github-event") event: string,
    @Body() body: any,
    @Res() res: Response,
  ) {
    const rawBody = req.rawBody;
    if (rawBody && sig && !await this.github.verify(rawBody, sig, 1)) {
      res.status(HttpStatus.UNAUTHORIZED).json({ error: "Invalid signature" });
      return;
    }

    res.status(HttpStatus.OK).send("Received");

    this.processEvent(event, body).catch((err) =>
      this.logger.error(`Error processing GitHub event '${event}'`, err),
    );
  }

  private async processEvent(event: string, payload: any): Promise<void> {
    this.logger.log(`Processing GitHub event: ${event}`);
    console.dir({ event, payload }, { depth: null });
    if (
      event === "pull_request" &&
      ["opened", "closed", "synchronize"].includes(payload.action)
    ) {
      await this.github.handlePullRequest(payload);
    } else if (event === "issue_comment" && payload.action === "created") {
      await this.github.handleIssueComment(payload);
    } else if (event === "push") {
      await this.github.handlePush(payload);
    } else {
      this.logger.log(
        `Unhandled GitHub event type: ${event} (action: ${payload.action ?? "n/a"})`,
      );
    }
  }
}
