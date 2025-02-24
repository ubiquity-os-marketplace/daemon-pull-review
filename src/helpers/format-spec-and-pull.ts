import { Context } from "../types/context";
import { TokenLimits } from "../types/llm";
import { createKey } from "../handlers/key";
import { Issue } from "../types/github-types";
import { fetchPullRequestDiff } from "./pull-helpers/fetch-diff";
import { encodeAsync } from "./pull-helpers/pull-request-parsing";
export async function createPullSpecContextBlockSection({
  context,
  tokenLimits,
  issues,
}: {
  context: Context<"pull_request.edited" | "pull_request.opened" | "pull_request.reopened" | "pull_request.ready_for_review">;
  tokenLimits: TokenLimits;
  issues: Issue[];
}): Promise<string> {
  const block = [];
  for (const issue of issues) {
    const key = createKey(issue.html_url, context.logger);

    // specification or pull request body
    const specOrBody = issue.body || "No specification or body available";
    const specHeader = "Current Task Specification";
    const specBlock = [createHeader(specHeader, key), createSpecOrBody(specOrBody), createFooter(specHeader, key)];
    block.push(specBlock.join("\n"));
  }

  // Build the block with the diff in it's own section
  const pullKey = createKey(context.payload.pull_request.html_url, context.logger);
  const localContextWithoutDiff = [block.join("\n"), createHeader(`Pull Request Diff`, pullKey), createFooter(`Pull Request Diff`, pullKey)].join("\n");

  const tokenCount = (await encodeAsync(localContextWithoutDiff)).length;
  tokenLimits.runningTokenCount += tokenCount;
  tokenLimits.tokensRemaining -= tokenCount;

  // Fetch our diff if we have one; this excludes the largest of files to keep within token limits
  const { diff } = await fetchPullRequestDiff(context, tokenLimits);
  if (!diff) {
    throw context.logger.error("Error fetching the pull difference, aborting");
  }
  const localContextWithDiff = [block.join("\n"), createHeader(`Pull Request Diff`, pullKey), diff, createFooter(`Pull Request Diff`, pullKey)];
  return localContextWithDiff.join("\n");
}

function createHeader(content: string, repoString: string) {
  return `=== ${content} === ${repoString} ===\n`;
}

function createFooter(content: string, repoString: string) {
  return `=== End ${content} === ${repoString} ===\n`;
}

function createSpecOrBody(specOrBody: string) {
  return `${specOrBody}\n`;
}
