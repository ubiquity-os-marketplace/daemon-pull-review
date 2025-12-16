import { Octokit } from "@octokit/rest";
import { PullRequestSynchronizeEvent, PullRequestOpenedEvent } from "@octokit/webhooks-types";
import { setOutput } from "@actions/core";
import { coerceJsonEnv, mustGetEnv } from "./utils";

async function main() {
  const token = mustGetEnv("GITHUB_TOKEN");
  const event = coerceJsonEnv<PullRequestSynchronizeEvent | PullRequestOpenedEvent>("EVENT_PAYLOAD");

  if (event.pull_request.draft || event.pull_request.state !== "open") {
    setOutput("should_skip", "true");
    setOutput("prompt", "");
    return;
  }

  const owner = event.pull_request.base.repo.owner.login;
  const repo = event.pull_request.base.repo.name;
  const prNumber = event.pull_request.number;

  const octokit = new Octokit({ auth: token });

  const pr = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });

  const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  const botReviews = reviews
    .filter((review) => review.user?.type === "Bot")
    // sort ascending by submission time
    .sort((a, b) => new Date(a.submitted_at ?? 0).getTime() - new Date(b.submitted_at ?? 0).getTime());

  const lastReviewedSha = botReviews[-1]?.commit_id;
  const baseSha = lastReviewedSha || pr.data.base.sha;
  const headSha = pr.data.head.sha;

  const botReviewHistory = botReviews
    .map((review) => {
      const sha = review?.commit_id ?? "unknown-sha";
      const timestamp = review.submitted_at ?? "unknown-time";
      return `- ${timestamp} (${review.state}) @ ${sha}\n${review.body ?? "(no body)"}`;
    })
    .join("\n\n");

  const prompt = `
This is PR #${prNumber} for ${owner}/${repo}.

IMPORTANT: Perform an INCREMENTAL review only.
- You MUST review ONLY changes introduced since the last review. If there was no prior review, review all changes in the PR.
- Compute and analyze the diff range: ${baseSha}..${headSha}
- Use Git CLI to inspect ONLY this range (e.g. \`git diff ${baseSha}..${headSha}\`, \`git log --oneline ${baseSha}..${headSha}\`).
- Do NOT re-review code that was already covered in earlier reviews, unless a new change affects it.

Base/head commits for incremental diff:
- base (last-reviewed): ${baseSha}
- head (current PR head): ${headSha}

Review history (most recent last), including the commit SHA that review covered:
${botReviewHistory || "None found. Review from PR base to head."}

Review criteria (only within ${baseSha}..${headSha}):
- Code quality and best practices
- Potential bugs or issues
- Performance considerations
- Security concerns
- Test coverage

Pull request title and body:
----
${event.pull_request.title}
${event.pull_request.body ?? ""}
`.trim();

  setOutput("prompt", prompt);
  setOutput("should_skip", "false");
}

main().catch((e) => {
  console.error(e);
  setOutput("should_skip", "true");
  process.exit(1);
});
