export type CodeReviewAppParams = {
  taskSpecifications: string[];
};

export type TokenLimits = {
  modelMaxTokenLimit: number;
  maxCompletionTokens: number;
  runningTokenCount: number;
  tokensRemaining: number;
};
