import OpenAI from "openai";
import { Context } from "../types";
import { TOOL_METHODS, ToolMethod, ToolMethodParams, TOOLS } from "../handlers/autofix/autofix-tools";

export async function processLlmResponse(
  logger: Context["logger"],
  groundTruths: string[],
  res: OpenAI.Chat.Completions.ChatCompletion & {
    _request_id?: string | null;
    error?:
    | {
      message: string;
      code: number;
      metadata: object;
    }
    | undefined;
  }
) {
  if (!res.choices || res.choices.length === 0) {
    throw logger.error(`Unexpected no response from LLM, Reason: ${res.error ? res.error.message : "No reason specified"}`);
  }

  const answer = res.choices[0].message.content;
  if (!answer) {
    throw logger.error("Unexpected response format: Expected text block");
  }

  const inputTokens = res.usage?.prompt_tokens;
  const outputTokens = res.usage?.completion_tokens;

  if (inputTokens && outputTokens) {
    logger.info(`Number of tokens used: ${inputTokens + outputTokens}`);
  } else {
    logger.info(`LLM did not output usage statistics`);
  }

  return {
    answer,
    groundTruths,
  };
}

export async function processLlmResponseWithTools(
  context: Context<"issue_comment.created">,
  logger: Context["logger"],
  res: OpenAI.Chat.Completions.ChatCompletion & {
    _request_id?: string | null;
    error?:
    | {
      message: string;
      code: number;
      metadata: object;
    }
    | undefined;
  }
) {
  if (!res.choices || res.choices.length === 0) {
    throw logger.error(`Unexpected no response from LLM, Reason: ${res.error ? res.error.message : "No reason specified"}`);
  }

  if (!res.choices[0].message.tool_calls && !res.choices[0].message.content) {
    throw logger.error("Unexpected response format: Neither tool calls nor text block found");
  }

  const toolCalls = res.choices[0].message.tool_calls;

  if (!toolCalls) {
    return res.choices[0].message.content;
  }

  return await processToolCalls(toolCalls, context);
}

async function processToolCalls(toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[], context: Context<"issue_comment.created">) {
  const toolResponses: { role: "tool"; tool_call_id: string; content: string }[] = [];

  function createToolResponse(toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall, content: string) {
    toolResponses.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content,
    });
  }

  for (const toolCall of toolCalls) {
    const tool = TOOLS.find((tool) => tool.function.name === toolCall.function.name);
    if (!tool) {
      createToolResponse(toolCall, `${toolCall.function.name} not found in tools list`);
      continue;
    }

    const toolArgs: ToolMethodParams<keyof typeof TOOL_METHODS> = JSON.parse(toolCall.function.arguments) satisfies ToolMethodParams<keyof typeof TOOL_METHODS>;
    const toolMethod = TOOL_METHODS[tool.function.name as keyof typeof TOOL_METHODS] as ToolMethod;
    if (!toolMethod) {
      createToolResponse(toolCall, `${toolCall.function.name} not found in tool methods list`);
      continue;
    }

    const toolResponse = await toolMethod(toolArgs, context);

    if (!toolResponse) {
      createToolResponse(toolCall, `Tool ${toolCall.function.name} returned no response`);
      continue;
    }
    createToolResponse(toolCall, toolResponse);
  }

  return toolResponses;
}
