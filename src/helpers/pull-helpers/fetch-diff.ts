import { Context } from "../../types/context";
import { TokenLimits } from "../../types/llm";
import { processPullRequestDiff } from "./pull-request-parsing";

export async function fetchPullRequestDiff(context: Context<"pull_request.edited" | "pull_request.opened" | "pull_request.reopened" | "pull_request.ready_for_review">, tokenLimits: TokenLimits) {
  const { octokit } = context;
  let diff: string;
  const diffUrl = context.payload.pull_request.diff_url;

  try {
    const diffResponse = await octokit.request({
      method: "GET",
      url: diffUrl,
    });
    diff = diffResponse.data as string;
  } catch (e) {
    context.logger.error("Error fetching pull request diff", { e });
    return { diff: null };
  }

  return await processPullRequestDiff(diff, tokenLimits, context);
}
