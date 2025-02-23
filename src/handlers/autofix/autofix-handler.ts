import { Context } from "../../types";
import { CallbackResult } from "../../types/proxy";
import { AutofixAgent } from "./agent";

export async function autofixHandler(context: Context<"issue_comment.created">): Promise<CallbackResult> {
  const agent = new AutofixAgent(context);
  const finalOut = await agent.startAgent();

  if (finalOut) {
    await context.commentHandler.postComment(
      context,
      context.logger.ok((finalOut[finalOut.length - 1]?.content as string) || "Autofix handler executed successfully")
    );
    return {
      reason: "success",
      status: 200,
      content: { autofixHandler: finalOut[finalOut.length - 1] },
    };
  }

  return {
    reason: "failed",
    status: 500,
    content: "Autofix handler failed to execute",
  };
}
