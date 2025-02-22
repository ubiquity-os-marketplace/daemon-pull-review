import { ChatCompletionTool } from "openai/resources";
import { Context } from "../../types";
import { CodebaseSearch } from "./codebase-search";
import * as fs from "fs";
import * as path from "path";

type ToolMethods_ = typeof TOOL_METHODS;
export type ToolMethodParams<T extends keyof ToolMethods_> = Parameters<ToolMethods_[T]>[0];
export type ToolMethod<T extends keyof ToolMethods_ = keyof ToolMethods_> = (args: ToolMethodParams<T>, context: Context) => Promise<string>;

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
          base: {
            type: "string",
          },
          body: {
            type: "string",
          },
        },
        required: ["owner", "repo", "title", "head", "base", "body"],
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
      name: "mergePull",
      description: "Merges the given Pull",
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
          mergeMethod: {
            type: "string",
            enum: ["merge", "squash", "rebase"],
          },
        },
        required: ["owner", "repo", "pullNumber", "mergeMethod"],
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
];

export const TOOL_METHODS = {
  openPull: async function openPull(
    {
      owner,
      repo,
      title,
      head,
      base,
      body,
    }: {
      owner: string;
      repo: string;
      title: string;
      head: string;
      base: string;
      body: string;
    },
    context: Context
  ) {
    try {
      console.log("openPull", owner, repo, title, head, base, body);
      // const res = await context.octokit.rest.pulls.create({
      //     owner, repo, title, head, base, body,
      // });
      return `Pull opened successfully: Test Environment - ${owner} - ${repo} - ${title} - ${head} - ${base} - ${body}`;
    } catch (error) {
      return error;
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
    context: Context
  ) {
    try {
      console.log("commentOnPull", owner, repo, issueNumber, body);
      // const res = await context.octokit.rest.issues.createComment({
      //     owner, repo, issue_number: issueNumber, body
      // });

      return `Commented on pull successfully: Test Environment - ${owner} - ${repo} - ${issueNumber} - ${body}`;
    } catch (error) {
      return error;
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
    context: Context
  ) {
    try {
      console.log("updatePullBody", owner, repo, pullNumber, body);
      // const res = await context.octokit.rest.pulls.update({
      //     owner, repo, pull_number: pullNumber, body,
      // });

      return `Pull body updated successfully: Test Environment - ${owner} - ${repo} - ${pullNumber} - ${body} `;
    } catch (error) {
      return error;
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
    context: Context
  ) {
    console.log("requestReview", owner, repo, pullNumber, reviewers);
    try {
      // const res = await context.octokit.rest.pulls.requestReviewers({
      //     owner, repo, pull_number: pullNumber, reviewers,
      // });

      return `Requested review successfully: Test Environment - ${owner} - ${repo} - ${pullNumber} - ${reviewers.join(", ")}`;
    } catch (error) {
      return error;
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
    context: Context
  ) {
    try {
      console.log("mergePull", owner, repo, pullNumber, mergeMethod);
      // const res = await context.octokit.rest.pulls.merge({
      //     owner, repo, pull_number: pullNumber, merge_method: mergeMethod,
      // });

      return `Pull merged successfully: Test Environment - ${owner} - ${repo} - ${pullNumber} - ${mergeMethod}`;
    } catch (error) {
      return error;
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
    context: Context
  ) {
    try {
      console.log("searchCodebase", query, type);
      const codebaseSearch = new CodebaseSearch(context);
      return (await codebaseSearch.searchCodebase(query, type)).join("\n");
    } catch (error) {
      return error;
    }
  },
  getFileContent: async function getFileContent({ filePaths }: { filePaths: string[] }, context: Context) {
    console.log("getFileContent", filePaths);
    try {
      const baseDir = path.resolve(process.cwd(), "repo-clone");
      const results: string[] = [];
      for (const filePath of filePaths) {
        const content = fs.readFileSync(path.join(baseDir, filePath), { encoding: "utf-8" });
        results.push(content);
      }

      return results.join("\n");
    } catch (error) {
      return error;
    }
  },
  updateFileContent: async function updateFileContent({ filePath, content }: { filePath: string; content: string }) {
    console.log("updateFileContent", filePath, content);
    try {
      const baseDir = path.resolve(process.cwd(), "repo-clone");
      fs.writeFileSync(path.join(baseDir, filePath), content, { encoding: "utf-8" });
      return `Updated file content successfully: ${filePath}`;
    } catch (error) {
      return error;
    }
  },
};
