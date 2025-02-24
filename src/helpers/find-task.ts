import { Context } from "../types";

export async function findTask(context: Context<"issue_comment.created">) {
  const issue = await context.octokit.rest.issues.get({
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    issue_number: context.payload.issue.number,
  });

  const isPr = "pull_request" in issue.data;

  if (!isPr) {
    return issue.data;
  }

  const noSpecResponse = {
    body: "No task specification found",
  };

  const pr = await context.octokit.rest.pulls.get({
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    pull_number: context.payload.issue.number,
  });

  // we need to track the task which this PR is going to close
  const hashMatch = pr.data.body?.match(/#(\d+)/);
  const urlMatch = pr.data.body?.match(/https:\/\/github.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);

  if (!hashMatch && !urlMatch) {
    context.logger.error("No task reference found in PR body", {
      url: pr.data.html_url,
    });

    return noSpecResponse;
  }

  let taskNumber;
  let taskFetchCtx: null | { owner: string; repo: string; issueNumber: number } = null;

  if (hashMatch) {
    taskNumber = parseInt(hashMatch[1]);
    if (!taskNumber) {
      context.logger.error("No task number found in PR body", {
        url: pr.data.html_url,
      });
      return;
    }
    taskFetchCtx ??= {
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      issueNumber: taskNumber,
    };
  } else if (urlMatch) {
    // this could be cross repo, cross org, etc
    taskNumber = parseInt(urlMatch[3]);
    if (!taskNumber) {
      context.logger.error("No task number found in PR body", {
        url: pr.data.html_url,
      });
      return;
    }

    taskFetchCtx ??= {
      owner: urlMatch[1],
      repo: urlMatch[2],
      issueNumber: taskNumber,
    };
  } else {
    context.logger.error("No task reference found in PR body", {
      url: pr.data.html_url,
    });
    return noSpecResponse;
  }

  const task = await context.octokit.rest.issues.get({
    owner: taskFetchCtx.owner,
    repo: taskFetchCtx.repo,
    issue_number: taskFetchCtx.issueNumber,
  });

  return task.data;
}
