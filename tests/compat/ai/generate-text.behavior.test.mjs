import assert from "node:assert/strict";
import {test} from "node:test";
import {generateText} from "ai";
import {MockLanguageModelV4} from "ai/test";

test("generates deterministic text through upstream AI SDK Core", async () => {
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
        outputTokens: {
          total: 4,
          text: 4,
          reasoning: undefined,
        },
      },
      warnings: [],
    },
  });

  const result = await generateText({model, prompt: "Say hello"});

  assert.equal(result.text, "Hello from deterministic AI");
  assert.equal(model.doGenerateCalls.length, 1);
  assert.deepEqual(model.doGenerateCalls[0]?.prompt, [{
    role: "user",
    content: [{type: "text", text: "Say hello"}],
    providerOptions: undefined,
  }]);
});
