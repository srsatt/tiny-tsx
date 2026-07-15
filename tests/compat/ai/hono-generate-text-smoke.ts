import {generateText} from "ai";
import {MockLanguageModelV4} from "ai/test";
import {Hono} from "hono";

const app = new Hono();

app.get("/ai", async context => {
  const model = new MockLanguageModelV4({
    doGenerate: {
      content: [{type: "text", text: "Hello from deterministic AI"}],
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
      warnings: [],
    },
  });
  const result = await generateText({model, prompt: "Say hello"});
  return context.text(result.text);
});

export default app;
