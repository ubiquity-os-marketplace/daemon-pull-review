import { coerceJsonEnv, mustGetEnv } from "./utils";
import { Octokit } from "@octokit/rest";
import { PullRequestSynchronizeEvent, PullRequestOpenedEvent } from "@octokit/webhooks-types";

async function main() {
  const token = mustGetEnv("GITHUB_TOKEN");
  const event = coerceJsonEnv<PullRequestSynchronizeEvent | PullRequestOpenedEvent>("EVENT_PAYLOAD");
  const codexResponse = mustGetEnv("CODEX_RESPONSE");

  const owner = event.pull_request.base.repo.owner.login;
  const repo = event.pull_request.base.repo.name;
  const prNumber = event.pull_request.number;

  const octokit = new Octokit({ auth: token });

  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    body: codexResponse,
    commit_id: event.pull_request.head.sha,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
