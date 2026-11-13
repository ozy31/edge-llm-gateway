// Token usage reported by OpenAI-compatible upstreams.
export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export function totalTokens(u: Usage | undefined | null): number {
  if (!u) return 0;
  if (typeof u.total_tokens === "number") return u.total_tokens;
  return (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
}

export function usageTokens(jsonText: string): number {
  try {
    return totalTokens((JSON.parse(jsonText) as { usage?: Usage }).usage);
  } catch {
    return 0;
  }
}
