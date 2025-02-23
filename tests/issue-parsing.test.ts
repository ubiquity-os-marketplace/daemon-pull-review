import { extractIssueUrls } from "../src/handlers/closing-keyword";
import { expect, it, describe } from "@jest/globals";

describe("extractIssueUrls", () => {
  const defaultRepo = "default-owner/default-repo";
  const testRepo = "test-owner/test-repo";

  it("should remove duplicate issue references", () => {
    const input = "Fixes #101 Resolves #101 Closes #101";
    const result = extractIssueUrls(input, testRepo);

    expect(result).toEqual(new Set([`https://github.com/${testRepo}/issues/101`]));
  });

  it("should handle mixed issue references", () => {
    const input = `
      Fixes https://github.com/${testRepo}/issues/202
      Closes test-owner/test-repo#303
      Resolves #404
    `;
    const result = extractIssueUrls(input, defaultRepo);

    expect(result).toEqual(
      new Set([
        `https://github.com/${testRepo}/issues/202`,
        "https://github.com/test-owner/test-repo/issues/303",
        `https://github.com/${defaultRepo}/issues/404`,
      ])
    );
  });

  it("should return an empty set for no matches", () => {
    const input = "This is just a random text with no issues mentioned.";
    const result = extractIssueUrls(input, testRepo);

    expect(result).toEqual(new Set());
  });
});
