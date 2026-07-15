import type {LanguageModelV4StreamPart} from "@ai-sdk/provider";
import {convertArrayToReadableStream} from "@ai-sdk/provider-utils/test";
import {streamText} from "ai";
import {MockLanguageModelV4} from "ai/test";
import {Hono} from "hono";

const app = new Hono();

app.get("/ai-stream", context => {
  const chunks: LanguageModelV4StreamPart[] = [
    {type: "text-start", id: "text-1"},
    {type: "text-delta", id: "text-1", delta: "Hello"},
    {type: "text-delta", id: "text-1", delta: " from streaming AI"},
    {type: "text-end", id: "text-1"},
    {
      type: "finish",
      finishReason: {unified: "stop", raw: "stop"},
      usage: {
        inputTokens: {
          total: 2,
          noCache: 2,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {total: 4, text: 4, reasoning: undefined},
      },
    },
  ];
  const model = new MockLanguageModelV4({
    doStream: {stream: convertArrayToReadableStream(chunks)},
  });
  const result = streamText({model, prompt: "Say hello"});
  return result.toTextStreamResponse();
});

export default app;
