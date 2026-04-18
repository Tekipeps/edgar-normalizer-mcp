import type { z } from "zod";

export interface McpTool<T extends z.ZodRawShape, U extends z.ZodRawShape> {
  name: string;
  config: {
    title:        string;
    description:  string;
    inputSchema:  T;
    outputSchema: U;
    _meta?: {
      surface?:       "both" | "mcp" | "ctx";
      queryEligible?: boolean;
      latencyClass?:  "fast" | "normal" | "slow";
      pricing?: {
        executeUsd?: string;
        queryUsd?:   string;
      };
    };
  };
  handler: (
    args: z.infer<z.ZodObject<T>>,
    extra: unknown,
  ) => Promise<{
    structuredContent: Record<string, unknown>;
    content: { type: "text"; text: string }[];
    isError?: boolean;
  }>;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms — please retry`)), ms),
    ),
  ]);
}
