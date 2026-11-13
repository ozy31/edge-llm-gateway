import { totalTokens, type Usage } from "./usage";

// Server-sent events from the upstream pass through to the client unchanged,
// event by event, while the gateway reads the final usage chunk so streamed
// requests are charged against the budget like any other.
//
// The gateway always asks the upstream for usage (stream_options.include_usage).
// If the client did not ask for it, that extra usage-only chunk is removed so
// clients that expect every chunk to have choices[0] keep working.

export function withUsageRequested(body: Record<string, unknown>): { body: Record<string, unknown>; clientWantsUsage: boolean } {
  const opts = (body.stream_options ?? {}) as Record<string, unknown>;
  const clientWantsUsage = opts.include_usage === true;
  return { body: { ...body, stream_options: { ...opts, include_usage: true } }, clientWantsUsage };
}

export function meterStream(
  upstream: ReadableStream<Uint8Array>,
  clientWantsUsage: boolean,
  onDone: (tokens: number) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let tokens = 0;

  const handleEvent = (event: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    const data = event
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (data && data !== "[DONE]") {
      try {
        const chunk = JSON.parse(data) as { choices?: unknown[]; usage?: Usage | null };
        if (chunk.usage) tokens = totalTokens(chunk.usage);
        if (!clientWantsUsage && chunk.usage && Array.isArray(chunk.choices) && chunk.choices.length === 0) return;
      } catch {
        // not JSON: pass it through untouched
      }
    }
    controller.enqueue(encoder.encode(event + "\n\n"));
  };

  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
        let i: number;
        while ((i = buffer.indexOf("\n\n")) !== -1) {
          handleEvent(buffer.slice(0, i), controller);
          buffer = buffer.slice(i + 2);
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer.trim()) handleEvent(buffer.trimEnd(), controller);
        onDone(tokens);
      },
    }),
  );
}
