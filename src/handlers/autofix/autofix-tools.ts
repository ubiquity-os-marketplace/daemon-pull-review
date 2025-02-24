import * as fs from "fs";
import * as path from "path";
import { ChatCompletionTool } from "openai/resources";
import { Context } from "../../types";
import { CodebaseSearch } from "./codebase-search";
import { AutofixAgent } from "./agent";

type ToolMethods_ = typeof TOOL_METHODS;
export type ToolMethodParams<T extends keyof ToolMethods_> = Parameters<ToolMethods_[T]>[0];
export type ToolMethod<T extends keyof ToolMethods_ = keyof ToolMethods_> = (
  args: ToolMethodParams<T>,
  context: Context,
  agent: AutofixAgent
) => Promise<string>;

export const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "openPull",
      description: "Opens a Pull in the given repository",
      parameters: {
        type: "object",
        properties: {
          owner: {
            type: "string",
          },
          repo: {
            type: "string",
          },
          title: {
            type: "string",
          },
          head: {
            type: "string",
          },
          body: {
            type: "string",
          },
        },
        required: ["owner", "repo", "title", "head", "body"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "commentOnPull",
      description: "Comments on the given Pull",
      parameters: {
        type: "object",
        properties: {
          owner: {
            type: "string",
          },
          repo: {
            type: "string",
          },
          issueNumber: {
            type: "number",
          },
          body: {
            type: "string",
          },
        },
        required: ["owner", "repo", "issueNumber", "body"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "updatePullBody",
      description: "Updates the body of the given Pull",
      parameters: {
        type: "object",
        properties: {
          owner: {
            type: "string",
          },
          repo: {
            type: "string",
          },
          pullNumber: {
            type: "number",
          },
          body: {
            type: "string",
          },
        },
        required: ["owner", "repo", "pullNumber", "body"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "requestReview",
      description: "Requests a review from the given reviewers",
      parameters: {
        type: "object",
        properties: {
          owner: {
            type: "string",
          },
          repo: {
            type: "string",
          },
          pullNumber: {
            type: "number",
          },
          reviewers: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },
        required: ["owner", "repo", "pullNumber", "reviewers"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "searchCodebase",
      description: "Searches the codebase for the given query",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
          },
          type: {
            type: "string",
            enum: ["path", "filename", "regex"],
          },
        },
        required: ["query", "type"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "getFileContent",
      description: "Gets the content of the given file paths",
      parameters: {
        type: "object",
        properties: {
          filePaths: {
            type: "array",
            items: {
              type: "string",
            },
          },
        },
        required: ["filePaths"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "updateFileContent",
      description: "Updates the content of the given file",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
          },
          content: {
            type: "string",
          },
        },
        required: ["filePath", "content"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "createBranch",
      description: "Creates a branch in the given repository",
      parameters: {
        type: "object",
        properties: {
          owner: {
            type: "string",
          },
          repo: {
            type: "string",
          },
          branchName: {
            type: "string",
          },
        },
        required: ["owner", "repo", "branchName"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "commitSingleFile",
      description: "Commits the changes in the given file",
      parameters: {
        type: "object",
        properties: {
          owner: {
            type: "string",
          },
          repo: {
            type: "string",
          },
          branch: {
            type: "string",
          },
          message: {
            type: "string",
          },
          content: {
            type: "string",
          },
          filePath: {
            type: "string",
          },
        },
        required: ["owner", "repo", "branch", "message", "content", "filePath"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
];

export const TOOL_METHODS = {
  openPull: async function openPull(
    {
      owner,
      repo,
      title,
      body,
      head,
    }: {
      owner: string;
      repo: string;
      title: string;
      body: string;
      head: string;
    },
    context: Context,
    agent: AutofixAgent
  ) {
    try {
      context.logger.info("openPull", { owner, repo, title, body, head });
      const res = await context.octokit.rest.pulls.create({
        owner: context.payload.repository.owner.login,
        repo,
        title,
        head,
        base: agent?.forkedRepoBranch || context.payload.repository.default_branch,
        body,
      });
      return `Pull opened successfully: ${res.data.html_url}`;
    } catch (error) {
      context.logger.error(String(error));
      return String(error);
    }
  },
  createBranch: async function createBranch(
    {
      owner,
      repo,
      branchName,
    }: {
      owner: string;
      repo: string;
      branchName: string;
    },
    context: Context,
    agent: AutofixAgent
  ) {
    let sha: string;

    if ("pull_request" in context.payload) {
      sha = context.payload.pull_request.head.sha;
    } else {
      const res = await context.octokit.rest.repos.getBranch({
        owner: context.payload.repository.owner.login,
        repo,
        branch: agent?.forkedRepoBranch || context.payload.repository.default_branch,
      });
      sha = res.data.commit.sha;
    }

    try {
      context.logger.info("createBranch", { owner, repo, branchName });
      const res = await context.octokit.rest.git.createRef({
        owner: context.payload.repository.owner.login,
        repo,
        ref: `refs/heads/${branchName}`,
        sha,
      });

      return `Branch created successfully: ${res.data.url}`;
    } catch (error) {
      context.logger.error(String(error));
      return String(error);
    }
  },
  commitSingleFile: async function commitSingleFile(
    {
      owner,
      repo,
      branch,
      message,
      content,
      filePath,
    }: {
      owner: string;
      repo: string;
      branch: string;
      message: string;
      content: string;
      filePath: string;
    },
    context: Context,
    _agent: AutofixAgent
  ) {
    let fileSha: string;

    try {
      const res = await context.octokit.rest.repos.getContent({
        owner: context.payload.repository.owner.login,
        repo,
        path: filePath,
        ref: branch,
      });

      if ("sha" in res.data) {
        fileSha = res.data.sha;
      } else {
        fileSha = "";
      }
    } catch (error) {
      context.logger.error(String(error));
      return String(error);
    }

    try {
      context.logger.info("createCommit", { owner, repo, branch, message, content });
      const res = await context.octokit.rest.repos.createOrUpdateFileContents({
        /** */
        owner: context.payload.repository.owner.login,
        repo,
        message,
        content: Buffer.from(content).toString("base64"),
        path: filePath,
        branch,
        sha: fileSha,
      });

      return `Commit created successfully: ${res.data.commit.html_url}`;
    } catch (error) {
      context.logger.error(String(error));
      return String(error);
    }
  },
  commentOnPull: async function commentOnPull(
    {
      owner,
      repo,
      issueNumber,
      body,
    }: {
      owner: string;
      repo: string;
      issueNumber: number;
      body: string;
    },
    context: Context,
    _agent: AutofixAgent
  ) {
    try {
      context.logger.info("commentOnPull", { owner, repo, issueNumber, body });
      const res = await context.octokit.rest.issues.createComment({
        owner: context.payload.repository.owner.login,
        repo,
        issue_number: issueNumber,
        body,
      });

      return `Commented on pull successfully: ${res.data.html_url}`;
    } catch (error) {
      context.logger.error(String(error));
      return String(error);
    }
  },
  updatePullBody: async function updatePullBody(
    {
      owner,
      repo,
      pullNumber,
      body,
    }: {
      owner: string;
      repo: string;
      pullNumber: number;
      body: string;
    },
    context: Context,
    _agent: AutofixAgent
  ) {
    try {
      context.logger.info("updatePullBody", { owner, repo, pullNumber, body });
      const res = await context.octokit.rest.pulls.update({
        owner: context.payload.repository.owner.login,
        repo,
        pull_number: pullNumber,
        body,
      });

      return `Pull body updated successfully: ${res.data.html_url}`;
    } catch (error) {
      context.logger.error(String(error));
      return String(error);
    }
  },
  requestReview: async function requestReview(
    {
      owner,
      repo,
      pullNumber,
      reviewers,
    }: {
      owner: string;
      repo: string;
      pullNumber: number;
      reviewers: string[];
    },
    context: Context,
    _agent: AutofixAgent
  ) {
    context.logger.info("requestReview", { owner, repo, pullNumber, reviewers });
    try {
      const res = await context.octokit.rest.pulls.requestReviewers({
        owner: context.payload.repository.owner.login,
        repo,
        pull_number: pullNumber,
        reviewers,
      });

      return `Requested review successfully: ${res.data.html_url}`;
    } catch (error) {
      context.logger.error(String(error));
      return String(error);
    }
  },
  mergePull: async function mergePull(
    {
      owner,
      repo,
      pullNumber,
      mergeMethod,
    }: {
      owner: string;
      repo: string;
      pullNumber: number;
      mergeMethod: "merge" | "squash" | "rebase";
    },
    context: Context,
    _agent: AutofixAgent
  ) {
    try {
      context.logger.info("mergePull", { owner, repo, pullNumber, mergeMethod });
      const res = await context.octokit.rest.pulls.merge({
        owner: context.payload.repository.owner.login,
        repo,
        pull_number: pullNumber,
        merge_method: mergeMethod,
      });

      return `${res.data.merged ? "Merged" : "Not merged"} successfully: ${res.data.sha}`;
    } catch (error) {
      context.logger.error(String(error));
      return String(error);
    }
  },
  searchCodebase: async function searchCodebase(
    {
      query,
      type,
    }: {
      query: string;
      type: "path" | "filename" | "regex";
    },
    context: Context,
    _agent: AutofixAgent
  ) {
    try {
      context.logger.info("searchCodebase", { query, type });
      const codebaseSearch = new CodebaseSearch(context);
      return (await codebaseSearch.searchCodebase(query, type)).join("\n");
    } catch (error) {
      context.logger.error(String(error));
      return String(error);
    }
  },
  getFileContent: async function getFileContent({ filePaths }: { filePaths: string[] }, context: Context) {
    context.logger.info("getFileContent", { filePaths });
    try {
      const baseDir = path.resolve(process.cwd(), "../repo-clone");
      const results: string[] = [];
      for (const filePath of filePaths) {
        const content = fs.readFileSync(path.join(baseDir, filePath), { encoding: "utf-8" });
        results.push(content);
      }

      return results.join("\n");
    } catch (error) {
      context.logger.error(String(error));
      return String(error);
    }
  },
  updateFileContent: async function updateFileContent({ filePath, content }: { filePath: string; content: string }, context: Context) {
    context.logger.info("updateFileContent", { filePath, content });
    try {
      const baseDir = path.resolve(process.cwd(), "../repo-clone");
      fs.writeFileSync(path.join(baseDir, filePath), content, { encoding: "utf-8" });
      return `Updated file content successfully: ${filePath}`;
    } catch (error) {
      console.error(String(error));
      return String(error);
    }
  },
};
