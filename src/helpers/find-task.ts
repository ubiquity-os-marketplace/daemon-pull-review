import { Context } from "../types";

export async function findTask(context: Context<"issue_comment.created">) {
  // need to get the author of the task
  const issue = await context.octokit.rest.issues.get({
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    issue_number: context.payload.issue.number,
  });

  const isPr = "pull_request" in issue.data;

  // if its a PR we want the author of the task, not the PR author

  if (!isPr) {
    return issue.data;
  }

  const pr = await context.octokit.rest.pulls.get({
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    pull_number: context.payload.issue.number,
  });

  if (!pr.data.body) {
    console.log("No body found for PR, could not map Author to UbiquityOS", {
      url: pr.data.html_url,
    });
    return;
  }

  // we need to track the task which this PR is going to close
  const hashMatch = pr.data.body.match(/#(\d+)/);
  const urlMatch = pr.data.body.match(/https:\/\/github.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);

  if (!hashMatch && !urlMatch) {
    console.log("No task reference found in PR body, could not map Author to UbiquityOS", {
      url: pr.data.html_url,
    });
    return;
  }

  let taskNumber;
  let taskFetchCtx: null | { owner: string; repo: string; issueNumber: number } = null;

  if (hashMatch) {
    taskNumber = parseInt(hashMatch[1]);
    if (!taskNumber) {
      console.log("No task number found in PR body, could not map Author to UbiquityOS", {
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
      console.log("No task number found in PR body, could not map Author to UbiquityOS", {
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
    console.log("No task reference found in PR body, could not map Author to UbiquityOS", {
      url: pr.data.html_url,
    });
    return;
  }

  const task = await context.octokit.rest.issues.get({
    owner: taskFetchCtx.owner,
    repo: taskFetchCtx.repo,
    issue_number: taskFetchCtx.issueNumber,
  });

  if (!task.data.user) {
    console.log("No task author found for issue", {
      url: task.data.html_url,
    });
    return;
  }

  return task.data;
}
