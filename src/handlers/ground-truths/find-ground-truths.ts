import { Context } from "../../types";
import { CodeReviewAppParams } from "../../types/llm";
import { createGroundTruthSysMsg } from "./create-system-message";
import { CODE_REVIEW_GROUND_TRUTHS_SYSTEM_MESSAGE } from "./prompts";

export async function findGroundTruths(context: Context, params: CodeReviewAppParams): Promise<string[]> {
  const {
    adapters: {
      openRouter: { completions },
    },
  } = context;
  const systemMsgObj = CODE_REVIEW_GROUND_TRUTHS_SYSTEM_MESSAGE;
  const systemMsg = createGroundTruthSysMsg(systemMsgObj);

  return completions.createGroundTruthCompletion(context, params.taskSpecifications, systemMsg);
}
