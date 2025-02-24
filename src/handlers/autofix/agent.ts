/**
 * The Autofix Agent is responsible for detecting bugs within scope of the current PR and
 * then implementing the necessary changes to fix the bug by creating a new pull request.
 *
 * - First it consumes the conversation history deducing the bugs being discussed.
 * - Then it pulls the base branch of the repository
 * - It is then allowed to index the codebase and apply the necessary changes
 * - Finally it creates a new pull request with the changes
 */

import { ChatCompletionCreateParamsNonStreaming } from "openai/resources";
import { Context } from "../../types";
import { CodebasePrimer } from "./codebase-primer";
import { CodebaseSearch } from "./codebase-search";
import { AutoFixComment, getTaskData } from "./comments";
import { TOOLS } from "./autofix-tools";
import { processLlmResponseWithTools } from "../../helpers/process-llm-response";
import { PROMPTS } from "../prompt";

export class AutofixAgent {
  context: Context<"issue_comment.created">;
  logger: Context["logger"];

  codebasePrimer: CodebasePrimer | null = null;
  codebaseSearch: CodebaseSearch;

  forkedRepoUrl: string | null = null;
  forkedRepoBranch: string | null = null;

  initialized = false;

  constructor(context: Context<"issue_comment.created">) {
    this.context = context;
    this.logger = context.logger;
    this.codebaseSearch = new CodebaseSearch(context);
  }

  /**
   * Starts the Autofix Agent
   * - Deduces the bugs from the conversation
   * - Gives the bug report to the agent alongside
   * - The LLM will begin searching the codebase for the bugs
   */
  async startAgent() {
    await this.initialize();

    const data = await getTaskData(this.context);
    if (!data) {
      throw this.logger.error("No data found for bug deduction");
    }

    return await this.fixBugs(data);
  }

  async fixBugs(bugReport: { comments: AutoFixComment[]; prDiff: string; taskSpecification: string }) {
    let { messages, res } = await this.messageLlm({
      model: this.context.config.openRouterAiModel,
      messages: [
        {
          role: "system",
          content: PROMPTS["autofixAgent"],
        },
        {
          role: "user",
          content: `# Task Specification\n\n${bugReport.taskSpecification}\n\n# Pull Request Diff\n\n${bugReport.prDiff}\n\n# Comments\n\n${bugReport.comments
            .sort((a: { created_at: string }, b: { created_at: string }) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .map((comment: unknown) => `${JSON.stringify(comment, null, 2)}\n`)
            .join("\n")}`,
        },
      ],
    });

    const logInterval = this.backgroundLog("Fixing bugs...");

    while (true) {
      if (res) {
        const toolCallResponses = await processLlmResponseWithTools(this.context, this, res);
        if (!toolCallResponses?.length) {
          messages.push({
            role: "assistant",
            content: res.choices[0].message.content,
          });
          continue;
        }

        if (typeof toolCallResponses === "string") {
          messages.push({
            role: "assistant",
            content: toolCallResponses,
          });
          break;
        }
        messages.push(res.choices[0].message);
        for (const toolCall of toolCallResponses) {
          messages.push(toolCall);
        }

        const { messages: newMessages, res: newRes } = await this.messageLlm({
          model: this.context.config.openRouterAiModel,
          messages,
        });

        messages = newMessages;
        res = newRes;
      } else {
        break;
      }
    }
    clearInterval(logInterval);

    this.logger.info("Bug fixing completed", { messages });

    return messages;
  }

  async messageLlm(options: ChatCompletionCreateParamsNonStreaming) {
    const {
      adapters: { openRouter },
      config: { openRouterAiModel },
    } = this.context;
    const res = await openRouter.completions._client.chat.completions.create({
      ...options,
      tools: TOOLS,
      model: openRouterAiModel,
      parallel_tool_calls: false,
      tool_choice: "auto",
    });

    return {
      messages: options.messages,
      res,
    };
  }

  async getForkedRepoUrl() {
    if (!this.forkedRepoUrl) {
      const { octokit, payload } = this.context;

      const pullRequest = await octokit.rest.pulls.get({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        pull_number: payload.issue.number,
      });

      const {
        head: {
          repo: { clone_url },
          ref,
        },
      } = pullRequest.data;

      this.forkedRepoUrl = clone_url;
      this.forkedRepoBranch = ref;
    }
    return this.forkedRepoUrl;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    if (this.context.config.autofix.useForkCodebase) {
      await this.getForkedRepoUrl();
      this.logger.info(`Using forked codebase: ${this.forkedRepoUrl}@${this.forkedRepoBranch}`);
    } else {
      this.logger.info(`Using base codebase: ${this.context.payload.repository.full_name}@${this.context.payload.repository.default_branch}`);
    }

    this.codebasePrimer = new CodebasePrimer(
      this.context,
      this.forkedRepoUrl ? this.forkedRepoUrl : `https://github.com/${this.context.payload.repository.owner.login}/${this.context.payload.repository.name}.git`,
      this.forkedRepoBranch ? this.forkedRepoBranch : this.context.payload.repository.default_branch
    );

    await this.codebasePrimer.pullCodebase();
    this.initialized = true;
  }

  backgroundLog(message: string) {
    const steps = ["|", "/", "-", "\\"];
    let i = 0;
    return setInterval(() => {
      process.stdout.write(`\r${steps[i++]} ${message}`);
      i &= 3;
    }, 5000);
  }
}
