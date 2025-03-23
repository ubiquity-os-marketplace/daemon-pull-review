import { StaticDecode, Type as T } from "@sinclair/typebox";
import ms, { StringValue } from "ms";

export const pluginSettingsSchema = T.Object(
  {
    openRouterAiModel: T.String({
      default: "anthropic/claude-3.5-sonnet",
      description: "The model to use for OpenRouter AI",
      examples: ["anthropic/claude-3.5-sonnet"],
    }),
    openRouterBaseUrl: T.String({
      default: "https://openrouter.ai/api/v1",
      description: "The base URL for OpenRouter AI",
      examples: ["https://openrouter.ai/api/v1"],
    }),
    maxRetries: T.Number({ default: 5, description: "The maximum number of retries for a LLM request", examples: [5] }),
    reviewInterval: T.Transform(
      T.Optional(T.String({ default: "1 Day", description: "How often a review can be performed. Omit for no limit", examples: ["1 Day", "1 Hour", "1 Week"] }))
    )
      .Decode((v?: string) => {
        if (!v) return;
        try {
          const val = ms(v as StringValue);
          if (!val || isNaN(Number(val))) throw new Error("Invalid value");
          return val;
        } catch {
          throw new Error("Invalid review interval value. Must be a valid time string.");
        }
      })
      .Encode((v) => {
        if (!v) return "No Limit";
        return ms(v, { long: true });
      }),
  },
  { default: {} }
);

export type PluginSettings = StaticDecode<typeof pluginSettingsSchema>;
