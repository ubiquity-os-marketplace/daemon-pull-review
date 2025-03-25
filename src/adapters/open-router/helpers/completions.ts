import { getOpenRouterModelTokenLimits, OpenRouterError, retry } from "@ubiquity-os/plugin-sdk/helpers";
import OpenAI from "openai";
import { createCodeReviewSysMsg, llmQuery } from "../../../handlers/prompt";
import { Context } from "../../../types";
import { SuperOpenRouter } from "./open-router";

export class OpenRouterCompletion extends SuperOpenRouter {
  constructor(client: OpenAI, context: Context) {
    super(client, context);
  }

  async getModelTokenLimits(model: string) {
    const modelLimits = await getOpenRouterModelTokenLimits(model);
    if (!modelLimits) {
      throw this.context.logger.error(`Model not found: ${model}`);
    }
    return modelLimits;
  }

  async createCodeReviewCompletion(model: string, localContext: string, groundTruths: string[], botName: string, maxCompletionTokens: number) {
    const sysMsg = createCodeReviewSysMsg(groundTruths, botName, localContext);

    this.context.logger.debug(`System message: ${sysMsg}`);

    const { completion, reviewData } = await retry(
      async () => {
        const res = (await this.client.chat.completions.create({
          model: model,
          max_completion_tokens: maxCompletionTokens,
          messages: [
            {
              role: "system",
              content: sysMsg,
            },
            {
              role: "user",
              content: llmQuery,
            },
          ],
          temperature: 0,
        })) as OpenAI.Chat.Completions.ChatCompletion | OpenRouterError;
        if ("error" in res) {
          throw this.context.logger.error(`Unexpected error from LLM: ${res.error.message} (${res.error.code})`, { err: res.error });
        }

        if (!res.choices || res.choices.length === 0) {
          throw this.context.logger.error(`Unexpected response from LLM: no choices found`);
        }

        const answer = res.choices[0].message.content;
        if (!answer) {
          throw this.context.logger.error("Unexpected response format: Expected text block");
        }
        const reviewData = this.validateReviewOutput(answer);

        return { completion: res, reviewData };
      },
      {
        maxRetries: this.context.config.maxRetryAttempts,
        onError: (err) => {
          this.context.logger.error(`LLM Error, retrying...`, { err });
        },
      }
    );

    const inputTokens = completion.usage?.prompt_tokens;
    const outputTokens = completion.usage?.completion_tokens;

    if (inputTokens && outputTokens) {
      this.context.logger.info(`Number of tokens used for code review: ${inputTokens + outputTokens}`, { inputTokens, outputTokens });
    } else {
      this.context.logger.info(`LLM did not output usage statistics`);
    }

    return reviewData;
  }

  async createGroundTruthCompletion(context: Context, groundTruthSource: string[], systemMsg: string) {
    const {
      config: { openRouterAiModel },
    } = context;

    return await retry(
      async () => {
        const res = (await this.client.chat.completions.create({
          model: openRouterAiModel,
          messages: [
            {
              role: "system",
              content: systemMsg,
            },
            {
              role: "user",
              content: groundTruthSource.join("\n"),
            },
          ],
        })) as OpenAI.Chat.Completions.ChatCompletion | OpenRouterError;
        if ("error" in res) {
          throw this.context.logger.error(`Unexpected error from LLM: ${res.error.message} (${res.error.code})`, { err: res.error });
        }

        if (!res.choices || res.choices.length === 0) {
          throw this.context.logger.error(`Unexpected response from LLM: no choices found`);
        }
        const answer = res.choices[0].message.content;
        if (!answer) {
          throw this.context.logger.error("Unexpected response format: Expected text block");
        }

        return this.validateGroundTruthsOutput(answer);
      },
      {
        maxRetries: this.context.config.maxRetryAttempts,
        onError: (err) => {
          this.context.logger.error(`LLM Error, retrying...`, { err });
        },
      }
    );
  }

  validateReviewOutput(reviewString: string) {
    const { logger } = this.context;
    let reviewOutput: { confidenceThreshold: number; reviewComment: string };

    try {
      reviewOutput = JSON.parse(reviewString);
    } catch (err) {
      throw logger.error("Couldn't parse JSON output; Aborting", { err });
    }
    if (typeof reviewOutput.reviewComment !== "string") {
      throw logger.error("LLM failed to output review comment successfully");
    }
    const confidenceThreshold = Number(reviewOutput.confidenceThreshold);
    if (Number.isNaN(confidenceThreshold) || confidenceThreshold < 0 || confidenceThreshold > 1) {
      throw logger.error("LLM failed to output a confidence threshold successfully");
    }

    return { confidenceThreshold, reviewComment: reviewOutput.reviewComment };
  }

  validateGroundTruthsOutput(truthsString: string | null): string[] {
    const { logger } = this.context;

    let truths;
    if (!truthsString) {
      throw logger.error("Failed to generate ground truths");
    }

    try {
      truths = JSON.parse(truthsString);
    } catch (err) {
      throw logger.error("Failed to parse ground truths", { err });
    }
    if (!Array.isArray(truths)) {
      throw logger.error("Ground truths must be an array");
    }

    if (truths.length > 10) {
      throw logger.error("Ground truths must not exceed 10");
    }

    truths.forEach((truth: string) => {
      if (typeof truth !== "string") {
        throw logger.error("Each ground truth must be a string");
      }
    });

    return truths;
  }
}
