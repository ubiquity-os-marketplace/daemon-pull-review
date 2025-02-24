import { ChatCompletionCreateParamsNonStreaming } from "openai/resources";
import { Context } from "../../types";
import { GROUND_TRUTHS, PROMPTS } from "../prompt";
import { processLlmResponse } from "../../helpers/process-llm-response";
import { findTask, TaskIssue } from "../../helpers/find-task";
import { getUserRole } from "./user-roles";
import ms from "ms";
import { RestEndpointMethodTypes } from "@octokit/rest";

export type AutoFixComment = {
  id: number;
  body: string;
  user: string;
  created_at: string;
};

/**
 * Uses the conversation across the PR and issue to deduce the bugs
 * being discussed in the conversation.
 */
export class ConversationBugDeduction {
  context: Context<"issue_comment.created">;

  constructor(context: Context<"issue_comment.created">) {
    this.context = context;
  }

  async conversationBugDeduction(comments: AutoFixComment[], prDiff: string, taskSpec: string) {
    const {
      config: { openRouterAiModel },
    } = this.context;

    if (!taskSpec) {
      throw new Error("No task specification found");
    }

    const sysMsg = this.buildSysMessage("integratedSpecAndBugReview", GROUND_TRUTHS.bugDeduction.fromSpecAndBugReview);

    const options: ChatCompletionCreateParamsNonStreaming = {
      model: openRouterAiModel,
      messages: [
        {
          role: "system",
          content: sysMsg,
        },
        {
          role: "user",
          content: `# Task Specification:::\n\n${taskSpec}\n\n# Pull Request Diff:::${prDiff}\n\n# Comments:::\n\n ${comments.map((comment) => `${JSON.stringify(comment, null, 2)}\n`).join("\n")}`,
        },
      ],
    };

    return await this.messageLlm(options, GROUND_TRUTHS.bugDeduction.fromSpecAndBugReview);
  }

  async getBugsFromConversation(withLlmCall = true) {
    const { octokit, payload } = this.context;
    const task = await findTask(this.context);
    const taskSpecification = task?.body || "No task specification found";
    const comments = await this.getComments(octokit, payload, task);
    const prDiff = await octokit.rest.pulls.get({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      pull_number: payload.issue.number,
      mediaType: {
        format: "diff",
      },
    });

    if (!withLlmCall) {
      return {
        comments,
        prDiff: prDiff.data as unknown as string,
        taskSpecification,
      };
    }

    return await this.conversationBugDeduction(comments, prDiff.data as unknown as string, taskSpecification);
  }

  async getComments(octokit: Context["octokit"], payload: Context<"issue_comment.created">["payload"], task: TaskIssue): Promise<AutoFixComment[]> {
    const allComments = [];

    const issueComments = await octokit.paginate(octokit.rest.issues.listComments, {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
    });

    const prComments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      pull_number: payload.issue.number,
    });

    const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      pull_number: payload.issue.number,
    });

    const reviewComments = [];

    for (const review of reviews) {
      const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        pull_number: payload.issue.number,
        review_id: review.id,
      });

      reviewComments.push(...comments);
    }

    allComments.push(...issueComments);
    allComments.push(...prComments);
    allComments.push(...reviewComments);

    const users = Array.from(new Set(allComments.map((comment) => comment.user?.login || comment.user?.name).filter((user): user is string => !!user)));
    const userRoles: Record<string, { role: string; weight: number }> = {};

    userRoles["Unknown"] = { role: "Unknown", weight: 0 };
    userRoles[task?.user?.login || "Unknown"] = { role: "Author", weight: task?.user?.login ? 1 : 0 };

    for (const user of users) {
      userRoles[user] = await getUserRole(this.context, user);
    }

    const weightingInterval = this.context.config.commentWeightInterval;

    return allComments
      .map((comment) => {
        if (comment.user?.type === "Bot") {
          return;
        }
        return {
          id: comment.id,
          weight: userRoles[comment.user?.login || comment.user?.name || "Unknown"]?.weight || 0,
          created_at: comment.created_at,
          user: comment.user?.login || comment.user?.name || "Unknown",
          body: comment.body || "No body",
        };
      })
      .filter((comment): comment is Exclude<typeof comment, undefined> => !!comment)
      .sort((a, b) => {
        const dateA = ms(a.created_at as unknown as number) as unknown as number;
        const dateB = ms(b.created_at as unknown as number) as unknown as number;
        const groupA = this.getTimeGroupingInterval(dateA, weightingInterval);
        const groupB = this.getTimeGroupingInterval(dateB, weightingInterval);

        if (groupA === groupB) {
          return b.weight - a.weight;
        }

        return groupA - groupB;
      });
  }

  getTimeGroupingInterval(time: number, interval: number) {
    return Math.floor(time / interval);
  }

  buildSysMessage(prompt: keyof typeof PROMPTS, groundTruths: string[]) {
    const sysMsg = PROMPTS[prompt];
    const groundTruthsStr = `Adhere to the following ground truths: \n${JSON.stringify(groundTruths)}\n`;
    return sysMsg.replace("{{ groundTruths }}", groundTruthsStr);
  }

  async messageLlm(options: ChatCompletionCreateParamsNonStreaming, groundTruths: string[]) {
    const {
      adapters: { openRouter },
      logger,
    } = this.context;
    const res = await openRouter.completions._client.chat.completions.create(options);
    return await processLlmResponse(logger, groundTruths, res);
  }
}
