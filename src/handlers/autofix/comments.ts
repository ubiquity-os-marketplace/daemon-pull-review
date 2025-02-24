import { Context } from "../../types";
import { findTask, TaskIssue } from "../../helpers/find-task";
import { getUserRole } from "./user-roles";
import ms from "ms";

export type AutoFixComment = {
  id: number;
  body: string;
  user: string;
  created_at: string;
};

export async function getTaskData(context: Context<"issue_comment.created">) {
  const { octokit, payload } = context;
  const task = await findTask(context);
  const taskSpecification = task?.body || "No task specification found";
  const comments = await getComments(context, task);
  const prDiff = await octokit.rest.pulls.get({
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    pull_number: payload.issue.number,
    mediaType: {
      format: "diff",
    },
  });

  return {
    comments,
    prDiff: prDiff.data as unknown as string,
    taskSpecification,
  };
}

async function getComments(context: Context<"issue_comment.created">, task: TaskIssue): Promise<AutoFixComment[]> {
  const { octokit, payload } = context;
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
    userRoles[user] = await getUserRole(context, user);
  }

  const weightingInterval = context.config.autofix.commentGroupingPeriod;

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
      const groupA = getTimeGroupingInterval(dateA, weightingInterval);
      const groupB = getTimeGroupingInterval(dateB, weightingInterval);

      if (groupA === groupB) {
        return b.weight - a.weight;
      }

      return groupA - groupB;
    });
}

function getTimeGroupingInterval(time: number, interval: number) {
  return Math.floor(time / interval);
}
