import { PullRequest } from "@octokit/graphql-schema";
import { Context } from "../types/context";

export type ClosedByPullRequestsReferences = {
  node: Pick<PullRequest, "url" | "title" | "number" | "body"> & { owner: string; name: string };
};

export type IssuesClosedByThisPr = {
  repository: {
    pullRequest: {
      closingIssuesReferences: {
        edges: ClosedByPullRequestsReferences[];
      };
    };
  };
};

export const closedByPullRequestsReferences = /* GraphQL */ `
  query closingIssuesReferencesQuery($owner: String!, $repo: String!, $pr_number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr_number) {
        closingIssuesReferences(first: 100) {
          edges {
            node {
              number
              title
              url
              body
              repository {
                name
                owner {
                  login
                }
              }
            }
          }
        }
      }
    }
  }
`;

export async function getLinkedIssues(context: Context<"pull_request.edited" | "pull_request.opened" | "pull_request.reopened" | "pull_request.ready_for_review">) {
  const prNumber = context.payload.pull_request.number;

  const response = await context.octokit.graphql<IssuesClosedByThisPr>(closedByPullRequestsReferences, {
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    pr_number: prNumber,
  });
  return response.repository.pullRequest.closingIssuesReferences.edges;
}
