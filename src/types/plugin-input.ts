import { StaticDecode, Type as T } from "@sinclair/typebox";
import ms from "ms";

export const pluginSettingsSchema = T.Object(
  {
    autofix: T.Object({ useForkCodebase: T.Boolean({ default: true }) }, { default: {} }),
    openRouterAiModel: T.String({ default: "anthropic/claude-3.5-sonnet" }),
    openRouterBaseUrl: T.String({ default: "https://openrouter.ai/api/v1" }),
    tokenLimit: T.Object(
      {
        context: T.Number({ default: 200000 }),
        completion: T.Number({ default: 4096 }),
      },
      { default: {} }
    ),
    commentWeights: T.Record(T.String(), T.Number(), {
      default: {
        contributor: 0.25,
        collaborator: 0.5,
        taskAuthor: 1,
      },
    }),
    commentWeightInterval: T.Transform(
      T.String({
        default: "1 Day",
        description:
          "When weighting comments, they are sorted by date first, then by weight if the dates are the same. This setting represents the timespan over which the weight of a comment is considered.",
      })
    )
      .Decode((value) => {
        let val: number;
        try {
          val = ms(value as unknown as number) as unknown as number;
        } catch (e) {
          throw new Error("Invalid time grouping interval");
        }
        return val;
      })
      .Encode((value) => ms(value)),
  },
  { default: {} }
);

export type PluginSettings = StaticDecode<typeof pluginSettingsSchema>;
