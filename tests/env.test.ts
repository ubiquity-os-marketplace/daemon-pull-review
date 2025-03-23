import { Value } from "@sinclair/typebox/value";
import { pluginSettingsSchema } from "../src/types";

describe("pluginSettingsSchema", () => {
  it("should have the correct default values", () => {
    const defaultValues = Value.Default(pluginSettingsSchema, {});
    expect(defaultValues).toEqual({
      openRouterAiModel: "anthropic/claude-3.5-sonnet",
      openRouterBaseUrl: "https://openrouter.ai/api/v1",
      reviewInterval: "1 Day",
      maxRetries: 5,
    });
  });
});
