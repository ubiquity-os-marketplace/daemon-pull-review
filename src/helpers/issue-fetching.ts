import { Context } from "../types/context";

export async function fetchIssue(context: Context, issueNum?: number, owner?: string, repo?: string) {
  const { payload, octokit } = context;

  try {
    const response = await octokit.rest.issues.get({
      owner: owner ?? payload.repository.owner.login,
      repo: repo ?? payload.repository.name,
      issue_number: issueNum ?? payload.pull_request.number,
    });
    return response.data;
  } catch (error) {
    context.logger.error(`Error fetching issue`, {
      err: error,
      owner: owner ?? payload.repository.owner.login,
      repo: repo ?? payload.repository.name,
      issueNum: issueNum ?? payload.pull_request.number,
    });
    return null;
  }
}
