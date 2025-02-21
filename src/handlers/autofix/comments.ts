import { ChatCompletionCreateParamsNonStreaming } from "openai/resources";
import { Context } from "../../types";
import { GROUND_TRUTHS, PROMPTS } from "../prompt";
import { processLlmResponse } from "../../helpers/process-llm-response";
import { writeFile } from "fs/promises";
import { findTask } from "../../helpers/find-task";

type AutoFixComment = {
  id: number;
  body: string;
  user: string;
  created_at: string;
};

/**
 * Uses the conversation across the PR and issue to deduce the bugs
 * being discussed in the conversation.
 *
 * @TODO Implement weighted scoring for the comments
 * @TODO Implement a way to filter out irrelevant comments, time-based maybe?
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

    const bugReport = await this.messageLlm(options, GROUND_TRUTHS.bugDeduction.fromSpecAndBugReview);

    await writeFile("bugReport.json", JSON.stringify({ bugReport }, null, 2));

    // const bugReport = await this.messageLlm(options, groundTruths);

    // const diffPrompt = "pullRequestDiffBugDeduction";
    // const diffGroundTruths = GROUND_TRUTHS.bugDeduction.fromPullRequestDiff;
    // const diffSysMsg = this.buildSysMessage(diffPrompt, diffGroundTruths);

    // const diffOptions: ChatCompletionCreateParamsNonStreaming = {
    //     model: openRouterAiModel,
    //     messages: [
    //         {
    //             role: "system",
    //             content: diffSysMsg
    //         },
    //         {
    //             role: "user",
    //             content: `# Bug Report\n\n${bugReport}\n\n# PR Diff:\n\n${prDiff}`
    //         }
    //     ]
    // };

    // const diffBugReport = await this.messageLlm(diffOptions, diffGroundTruths);

    // await writeFile("bugReport.json", JSON.stringify({ bugReport, diffBugReport }, null, 2))

    return {
      bugReport,
    };
  }

  async getBugsFromConversation(withLlmCall = true) {
    const { octokit, payload } = this.context;
    const comments = await this.getComments(octokit, payload);
    const prDiff = await octokit.rest.pulls.get({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      pull_number: payload.issue.number,
      mediaType: {
        format: "diff",
      },
    });

    const taskSpecification = (await findTask(this.context))?.body || "No task specification found";

    if (!withLlmCall) {
      return {
        comments,
        prDiff: prDiff.data as unknown as string,
        taskSpecification,
      };
    }

    return await this.conversationBugDeduction(comments, prDiff.data as unknown as string, taskSpecification);
  }

  async getComments(octokit: Context["octokit"], payload: Context<"issue_comment.created">["payload"]): Promise<AutoFixComment[]> {
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

    return allComments
      .map((comment) => {
        if (comment.user?.type === "Bot") {
          return;
        }
        return {
          id: comment.id,
          body: comment.body || "No body",
          user: comment.user?.login || comment.user?.name || "Unknown",
          created_at: comment.created_at,
        };
      })
      .filter((comment): comment is Exclude<typeof comment, undefined> => !!comment)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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
