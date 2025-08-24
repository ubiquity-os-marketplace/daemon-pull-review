import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { drop } from "@mswjs/data";
import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import { LogReturn, Logs } from "@ubiquity-os/ubiquity-os-logger";
import ms from "ms";
import OpenAI from "openai";
import { OpenRouterCompletion } from "../src/adapters/open-router/helpers/completions";
import { Context, SupportedEvents } from "../src/types";
import { Issue } from "../src/types/github-types";
import { db } from "./__mocks__/db";
import issueTemplate from "./__mocks__/issue-template";
import { server } from "./__mocks__/node";
import pullTemplate from "./__mocks__/pull-template";
import repoTemplate from "./__mocks__/repo-template";
import usersGet from "./__mocks__/users-get.json";
// Mock constants
const MOCK_ANSWER_PASSED = `{"confidenceThreshold": 1, "reviewComment": "passed"}`;

jest.unstable_mockModule("../src/helpers/pull-helpers/fetch-diff", () => ({
  fetchPullRequestDiff: jest.fn(() => ({ diff: "abc" })),
}));

beforeAll(() => {
  server.listen();
});

afterEach(() => {
  drop(db);
  server.resetHandlers();
});

afterAll(() => server.close());

describe("Pull Reviewer tests", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await setupTests();
  });

  describe("Perform pull precheck", () => {
    it("should skip review for draft PRs", async () => {
      const { PullReviewer } = await import("../src/handlers/pull-reviewer");
      const context = createContext();
      context.payload.pull_request.draft = true;
      const pullReviewer = new PullReviewer(context);

      const result = await pullReviewer.performPullPrecheck();
      expect(result.status).toBe(200);
      expect(result.reason).toContain("draft mode");
    });

    it("should skip review for closed PRs", async () => {
      const { PullReviewer } = await import("../src/handlers/pull-reviewer");
      const context = createContext();
      context.payload.pull_request.state = "closed";
      const pullReviewer = new PullReviewer(context);

      const result = await pullReviewer.performPullPrecheck();
      expect(result.status).toBe(200);
      expect(result.reason).toContain("closed");
    });

    it("should handle successful review", async () => {
      const { PullReviewer } = await import("../src/handlers/pull-reviewer");
      const pullReviewer = new PullReviewer(createContext());

      jest.spyOn(pullReviewer, "canPerformReview").mockImplementation(async () => true);
      jest.spyOn(pullReviewer, "getTasksFromPullRequest").mockImplementation(
        async () =>
          [
            {
              body: "Resolves #3",
              html_url: "https://github.com/ubiquity/test-repo/issue/1",
            },
          ] as unknown as Issue[]
      );

      pullReviewer.addThumbsUpReaction = jest.fn(() => Promise.resolve());
      const result = await pullReviewer.performPullPrecheck();
      expect(pullReviewer.addThumbsUpReaction).toHaveBeenCalled();
      expect(result).toEqual({ status: 200, reason: "Success" });
    });

    it("should handle cross-repo linked issue", async () => {
      const linkedIssue = {
        number: 1,
        title: "issue",
        url: "https://github.com/ubiquity-os-marketplace/daemon-pull-review/issue/1",
        body: "This is an issue",
        repository: {
          name: "daemon-pull-review",
          owner: {
            login: "ubiquity-os-marketplace",
          },
        },
      };
      const { PullReviewer } = await import("../src/handlers/pull-reviewer");
      const context = createContext();
      jest.spyOn(context.octokit, "graphql").mockResolvedValue({
        repository: {
          pullRequest: {
            closingIssuesReferences: {
              edges: [
                {
                  node: linkedIssue,
                },
              ],
            },
          },
        },
      });
      jest.spyOn(context.octokit.rest.issues, "get").mockImplementation(
        async (params) =>
          ({
            data: {
              number: params?.issue_number,
              title: "issue",
              url: `https://github.com/${params?.owner}/${params?.repo}/issue/${params?.issue_number}`,
              body: "This is an issue",
              repository: {
                name: params?.repo,
                owner: {
                  login: params?.owner,
                },
              },
            },
          }) as unknown as ReturnType<typeof context.octokit.rest.issues.get>
      );
      const pullReviewer = new PullReviewer(context);

      const issues = await pullReviewer.getTasksFromPullRequest();
      expect(issues).toEqual([linkedIssue]);
    });
  });

  describe("Review time restrictions", () => {
    it("should prevent multiple reviews within 24 hours", async () => {
      const { PullReviewer } = await import("../src/handlers/pull-reviewer");
      const context = createContext();
      const pullReviewer = new PullReviewer(context);

      jest.spyOn(pullReviewer.context.octokit, "paginate").mockResolvedValue([{ user: { type: "Bot" }, submitted_at: new Date().toISOString() }]);

      await expect(pullReviewer.canPerformReview()).rejects.toMatchObject({
        logMessage: {
          raw: expect.stringContaining("Review interval not met"),
        },
      });
    });

    it("should always allow review if PR author is collaborator", async () => {
      const { PullReviewer } = await import("../src/handlers/pull-reviewer");
      const context = createContext();
      const pullReviewer = new PullReviewer(context);

      jest.spyOn(pullReviewer.context.octokit, "paginate").mockResolvedValue([{ user: { type: "Bot" }, submitted_at: new Date().toISOString() }]);
      jest.spyOn(pullReviewer.context.octokit.rest.repos, "checkCollaborator").mockResolvedValue({ status: 204, data: {} as never, url: "", headers: {} });

      expect(await pullReviewer.canPerformReview()).toBe(true);
    });

    it("should allow review after 24 hours have passed", async () => {
      const { PullReviewer } = await import("../src/handlers/pull-reviewer");
      const context = createContext();
      const pullReviewer = new PullReviewer(context);

      // Mock an old bot review
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 25);

      jest.spyOn(pullReviewer.context.octokit, "paginate").mockResolvedValue([{ user: { type: "Bot" }, submitted_at: oldDate.toISOString() }]);

      expect(await pullReviewer.canPerformReview()).toBe(true);
    });
  });

  describe("Review data parsing", () => {
    it("should throw error for invalid confidence threshold", async () => {
      const context = createContext();
      const completion = new OpenRouterCompletion({} as unknown as OpenAI, context);

      const invalidInput = '{"confidenceThreshold": "invalid", "reviewComment": "test"}';

      expect(() => {
        completion.validateReviewOutput(invalidInput);
      }).toThrow(
        expect.objectContaining({
          logMessage: expect.objectContaining({
            raw: "LLM failed to output a confidence threshold successfully",
          }),
        })
      );
    });

    it("should throw error for missing review comment", async () => {
      const context = createContext();
      const completion = new OpenRouterCompletion({} as unknown as OpenAI, context);

      const invalidInput = '{"confidenceThreshold": 0.8}';

      expect(() => {
        completion.validateReviewOutput(invalidInput);
      }).toThrow(
        expect.objectContaining({
          logMessage: expect.objectContaining({
            raw: "LLM failed to output review comment successfully",
          }),
        })
      );
    });

    it("should accept string confidence threshold and convert to number", async () => {
      const context = createContext();
      const completion = new OpenRouterCompletion({} as unknown as OpenAI, context);

      const input = '{"confidenceThreshold": "0.8", "reviewComment": "test"}';
      const result = completion.validateReviewOutput(input);

      expect(result).toEqual({
        confidenceThreshold: 0.8,
        reviewComment: "test",
      });
    });
  });

  it("should successfully submit a code review", async () => {
    const { PullReviewer } = await import("../src/handlers/pull-reviewer");
    const context = createContext();
    const pullReviewer = new PullReviewer(context);

    context.octokit.rest.pulls.createReview = jest.fn().mockReturnValue({
      data: { html_url: "abc" },
    }) as unknown as typeof context.octokit.rest.pulls.createReview;

    await pullReviewer.submitCodeReview("Great job!", "COMMENT");

    expect(context.octokit.rest.pulls.createReview).toHaveBeenCalledWith({
      owner: "ubiquity",
      repo: "test-repo",
      pull_number: 3,
      body: "Great job!",
      event: "COMMENT",
    });
  });

  it("should correctly parse valid review data", async () => {
    const context = createContext();
    const completion = new OpenRouterCompletion({} as unknown as OpenAI, context);

    const result = completion.validateReviewOutput(MOCK_ANSWER_PASSED);
    expect(result).toEqual({
      confidenceThreshold: 1,
      reviewComment: "passed",
    });
  });

  it("should skip precheck if no issue is linked", async () => {
    const { PullReviewer } = await import("../src/handlers/pull-reviewer");
    const context = createContext();
    const pullReviewer = new PullReviewer(context);
    jest.spyOn(pullReviewer, "canPerformReview").mockImplementation(async () => true);

    // Mock empty closing issues
    jest.spyOn(pullReviewer, "checkIfPrClosesIssues").mockResolvedValue({
      closesIssues: false,
      issues: [],
    });

    expect(await pullReviewer.getTasksFromPullRequest()).toBe(null);
    expect(await pullReviewer.performPullPrecheck()).toEqual({ status: 200, reason: "Pull review data not found, Skipping automated review" });
  });
});

async function setupTests() {
  // Setup test data
  for (const item of usersGet) {
    db.users.create(item);
  }
  db.repo.create({
    ...repoTemplate,
  });
  db.issue.create({
    ...issueTemplate,
  });
  db.pull.create({ ...pullTemplate });
}

function createContext() {
  const logger = new Logs("debug");
  const user = db.users.findFirst({ where: { id: { equals: 1 } } });
  return {
    payload: {
      pull_request: db.pull.findFirst({ where: { id: { equals: 3 } } }) as unknown as Context["payload"]["pull_request"],
      sender: user,
      repository: db.repo.findFirst({ where: { id: { equals: 1 } } }) as unknown as Context["payload"]["repository"],
      action: "ready_for_review" as string,
      installation: { id: 1 } as unknown as Context["payload"]["installation"],
      organization: { login: "ubiquity" } as unknown as Context["payload"]["organization"],
      number: 3,
    },
    command: {
      name: null,
      parameters: null,
    },
    owner: "ubiquity",
    repo: "test-repo",
    logger: logger,
    config: {
      reviewInterval: ms("1 Day"),
      openRouterAiModel: "anthropic/claude-3.5-sonnet",
      openRouterBaseUrl: "https://openrouter.ai/api/v1",
      maxRetryAttempts: 1,
    },
    env: {
      UBIQUITY_OS_APP_NAME: "UbiquityOS",
      OPENROUTER_API_KEY: "test",
    },
    adapters: {
      openRouter: {
        completions: {
          getModelTokenLimits: () => ({
            contextLength: 50000,
            maxCompletionTokens: 50000,
          }),
          createCodeReviewCompletion: async () => JSON.parse(MOCK_ANSWER_PASSED),
          createGroundTruthCompletion: async () => [""],
        },
      },
    },
    octokit: new customOctokit(),
    eventName: "pull_request.ready_for_review" as SupportedEvents,
    commentHandler: {
      createCommentBody: jest.fn((ctx, log: LogReturn) => log.logMessage.raw),
    },
  } as unknown as Context;
}
