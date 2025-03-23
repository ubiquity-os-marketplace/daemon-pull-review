import ms from "ms";
import { createPullSpecContextBlockSection } from "../helpers/format-spec-and-pull";
import { closedByPullRequestsReferences, IssuesClosedByThisPr } from "../helpers/gql-queries";
import { fetchIssue } from "../helpers/issue-fetching";
import { encodeAsync } from "../helpers/pull-helpers/pull-request-parsing";
import { Context } from "../types";
import { CodeReviewStatus, Issue } from "../types/github-types";
import { TokenLimits } from "../types/llm";
import { CallbackResult } from "../types/proxy";
import { findGroundTruths } from "./ground-truths/find-ground-truths";
import { createCodeReviewSysMsg, llmQuery } from "./prompt";

export class PullReviewer {
  readonly context: Context;
  private readonly _reviewInterval: number | null = null;

  constructor(context: Context) {
    this.context = context;
    if (context.config.reviewInterval) {
      this._reviewInterval = context.config.reviewInterval;
    }
  }

  /**
   * Perform initial checks on a pull request to determine if review is needed
   * @returns CallbackResult indicating the status and reason
   */
  async performPullPrecheck(): Promise<CallbackResult> {
    const { logger, payload } = this.context;
    const { pull_request } = payload;

    // Check if PR is in draft mode, closed, or if we can perform a review
    if (pull_request.draft) {
      return { status: 200, reason: logger.info("PR is in draft mode, no action required").logMessage.raw };
    } else if (pull_request.state === "closed") {
      return { status: 200, reason: logger.info("PR is closed, no action required").logMessage.raw };
    } else if (!(await this.canPerformReview())) {
      return { status: 200, reason: logger.info("Cannot perform review at this time").logMessage.raw };
    } else if (this.context.payload.sender && pull_request.user.id !== this.context.payload.sender.id) {
      return { status: 200, reason: logger.info("Review wasn't requested by pull author").logMessage.raw };
    } else if (pull_request.author_association === "COLLABORATOR") {
      return { status: 200, reason: logger.info("Review was requested by core team, Skipping").logMessage.raw };
    }

    return await this._handleCodeReview();
  }

  /**
   * Handle the code review process for a pull request
   * @returns CallbackResult indicating the status and reason
   */
  private async _handleCodeReview(): Promise<CallbackResult> {
    const pullReviewData = await this.reviewPull();
    if (!pullReviewData) {
      return { status: 200, reason: "Pull review data not found, Skipping automated review" };
    }

    if (pullReviewData.confidenceThreshold > 0.5) {
      await this.addThumbsUpReaction();
    } else {
      await this.convertPullToDraft();
      await this.removeThumbsUpReaction();
      await this.submitCodeReview(pullReviewData.reviewComment, "REQUEST_CHANGES");
    }
    return { status: 200, reason: "Success" };
  }

  async addThumbsUpReaction(): Promise<void> {
    const { logger, payload } = this.context;

    try {
      await this.context.octokit.rest.reactions.createForIssue({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.pull_request.number,
        content: "+1",
      });
      logger.info("Added thumbs up reaction to pull request");
    } catch (error) {
      throw logger.error(`Failed to add thumbs up reaction ${error}`);
    }
  }

  /**
   * Remove thumbs up reaction from the pull request body if it exists
   */
  async removeThumbsUpReaction(): Promise<void> {
    const { logger, payload } = this.context;

    try {
      const reactions = await this.context.octokit.rest.reactions.listForIssue({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.pull_request.number,
      });

      const botReaction = reactions.data.find((reaction) => reaction.content === "+1" && reaction.user?.type === "Bot");

      if (botReaction) {
        await this.context.octokit.rest.reactions.deleteForIssue({
          owner: payload.repository.owner.login,
          repo: payload.repository.name,
          issue_number: payload.pull_request.number,
          reaction_id: botReaction.id,
        });
        logger.info("Removed thumbs up reaction from pull request");
      }
    } catch (error) {
      throw logger.error(`Failed to remove thumbs up reaction ${error}`);
    }
  }

  /**
   * Submit a code review for a pull request
   * @param review - The review comment
   * @param status - The review status (APPROVE, REQUEST_CHANGES, COMMENT)
   */
  async submitCodeReview(review: string | undefined, status: CodeReviewStatus): Promise<void> {
    const { logger, payload } = this.context;
    const { number, repository, action, sender } = payload;
    const { owner, name } = repository;

    logger.info(`${repository.owner.login}/${repository.name}#${number} - ${action} - ${sender?.login} - ${review}`);

    try {
      const response = await this.context.octokit.rest.pulls.createReview({
        owner: owner.login,
        repo: name,
        pull_number: number,
        body: review,
        event: status,
      });
      logger.info(`Code review submitted: ${response.data.html_url}`);
    } catch (er) {
      throw this.context.logger.error("Failed to submit code review", { err: er });
    }
  }

  /**
   * Check if a user is a collaborator
   * @param username - The username to check
   * @returns boolean indicating if user is a collaborator
   */
  async isUserCollaborator(username: string): Promise<boolean> {
    try {
      await this.context.octokit.rest.repos.checkCollaborator({
        username: username,
        owner: this.context.payload.repository.owner.login,
        repo: this.context.payload.repository.name,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a review can be performed on the pull request
   * @returns boolean indicating if review can be performed
   */
  async canPerformReview(): Promise<boolean> {
    const { logger, payload } = this.context;
    const { number, repository, action } = payload;
    const { owner, name } = repository;

    logger.info(`${repository.owner.login}/${repository.name}#${number} - ${action}`);

    if (payload.sender && (await this.isUserCollaborator(payload.sender.login))) {
      logger.info("User is a collaborator, skipping review interval check, proceeding with review", { user: payload.sender.login });
      return true;
    }

    const reviews = await this.context.octokit.paginate(this.context.octokit.rest.pulls.listReviews, {
      owner: owner.login,
      repo: name,
      pull_number: number,
      per_page: 100,
    });

    const botReviews = reviews.filter((review) => review.user?.type === "Bot");

    if (!botReviews.length) {
      logger.info("No bot reviews found");
      return true;
    }

    const lastReview = botReviews[botReviews.length - 1];
    if (!lastReview.submitted_at) {
      return true;
    }
    const lastReviewDate = new Date(lastReview.submitted_at);
    const now = new Date();
    const diff = now.getTime() - lastReviewDate.getTime();

    if (this._reviewInterval && diff < this._reviewInterval) {
      await this.convertPullToDraft();
      throw this.context.logger.warn(
        `Review interval not met, next review available in ${ms(this._reviewInterval - diff, { long: true })}. Last review was ${ms(diff, { long: true })} ago`
      );
    }

    logger.info(`Review interval met, proceeding with review. Last review was ${ms(diff, { long: true })} ago`);
    return true;
  }

  /**
   * Convert a pull request to draft mode
   * @param shouldConvert - Whether to convert the PR to draft
   * @param params - Parameters including nodeId and octokit instance
   */
  async convertPullToDraft() {
    const toDraft = /* GraphQL */ `mutation {
      convertPullRequestToDraft(input: {pullRequestId: "${this.context.payload.pull_request.node_id}"}) {
        pullRequest {
          id
          number
          isDraft
          title
        }
      }
    }`;

    try {
      await this.context.octokit.graphql(toDraft);
      this.context.logger.info(`Successfully converted pull request to draft mode.`);
    } catch (e) {
      throw this.context.logger.error("Failed to convert pull request to draft mode: ", { e });
    }
  }

  /**
   * Review a pull request using AI completion
   * @returns The completion result from the AI model
   */
  async reviewPull() {
    const {
      env: { UBIQUITY_OS_APP_NAME },
      config: { openRouterAiModel },
      adapters: {
        openRouter: { completions },
      },
    } = this.context;

    const taskSpecifications: string[] = [];
    const issues = await this.getTasksFromPullRequest();
    if (!issues) return null;

    issues.forEach((issue) => {
      if (!issue?.body) {
        throw this.context.logger.warn(`Task #${issue?.number} does not contain a specification and this cannot be automatically reviewed`);
      }
      taskSpecifications.push(issue.body);
    });

    const groundTruths = await findGroundTruths(this.context, { taskSpecifications });

    const sysPromptTokenCount = (await encodeAsync(createCodeReviewSysMsg(groundTruths, UBIQUITY_OS_APP_NAME, ""))).length;
    const queryTokenCount = (await encodeAsync(llmQuery)).length;

    const modelTokenLimits = await completions.getModelTokenLimits(openRouterAiModel);
    const tokenLimits: TokenLimits = {
      modelMaxTokenLimit: modelTokenLimits.contextLength,
      maxCompletionTokens: 2000, // this roughly corresponds to 10k characters which will be enough for a PR review comment
      runningTokenCount: 0,
      tokensRemaining: 0,
    };

    // what we start out with to include files
    tokenLimits.tokensRemaining = tokenLimits.modelMaxTokenLimit - tokenLimits.maxCompletionTokens - sysPromptTokenCount - queryTokenCount;

    this.context.logger.info("Starting token count", { tokenLimits });
    const formattedSpecAndPull = await createPullSpecContextBlockSection({
      context: this.context,
      tokenLimits,
      issues,
    });
    this.context.logger.info("Ending token count", { tokenLimits });

    return await completions.createCodeReviewCompletion(
      openRouterAiModel,
      formattedSpecAndPull,
      groundTruths,
      UBIQUITY_OS_APP_NAME,
      tokenLimits.maxCompletionTokens
    );
  }

  async checkIfPrClosesIssues(pr: { owner: string; repo: string; pr_number: number }) {
    const { octokit, logger } = this.context;
    const { owner, repo, pr_number } = pr;

    try {
      const result = await octokit.graphql<IssuesClosedByThisPr>(closedByPullRequestsReferences, {
        owner,
        repo,
        pr_number,
      });

      const closingIssues = result.repository.pullRequest.closingIssuesReferences.edges.map((edge) => edge.node);

      if (closingIssues.length > 0) {
        return {
          closesIssues: true,
          issues: closingIssues,
        };
      } else {
        return {
          closesIssues: false,
          issues: [],
        };
      }
    } catch (error) {
      logger.error("Error fetching closing issues:", { error: error instanceof Error ? error : undefined });
      return {
        closesIssues: false,
        issues: [],
      };
    }
  }

  async getTasksFromPullRequest() {
    const {
      payload: { pull_request },
      logger,
    } = this.context;

    const { issues: closingIssues } = await this.checkIfPrClosesIssues({
      owner: pull_request.base.repo.owner.login,
      repo: pull_request.base.repo.name,
      pr_number: pull_request.number,
    });
    logger.info(`Found ${closingIssues.length} linked issues`, { closingIssues: closingIssues.map((issue) => issue.url) });

    if (closingIssues.length === 0) {
      logger.info("You need to link an issue before converting the pull request to ready for review.");
      return null;
    }

    if (!closingIssues.every((issue) => issue.number)) {
      throw logger.error("Task number not found", { pull_request });
    }

    const issues = (await Promise.all(
      closingIssues.map(async (issue) => {
        const issueNumber = issue.number;
        const issueRepo = issue.repository.name;
        const issueOwner = issue.repository.owner.login;
        return fetchIssue(this.context, issueNumber, issueOwner, issueRepo);
      })
    )) as Issue[];

    if (issues.some((issue) => !issue) || !issues) {
      throw logger.error(`Error fetching issue, aborting`, {
        owner: this.context.payload.repository.owner.login,
        repo: this.context.payload.repository.name,
        issues: issues.map((issue) => issue.url),
      });
    }

    return issues;
  }
}
