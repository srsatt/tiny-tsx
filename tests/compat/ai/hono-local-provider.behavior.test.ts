import {expect, test} from "bun:test";
import app from "./hono-local-provider-smoke.ts";

test("uses a local OpenAI-compatible provider through upstream AI SDK code", async () => {
  let request: {
    url: string;
    method: string;
    authorization: string | null;
    body: {model?: string; messages?: unknown[]};
  } | undefined;
  const provider = Bun.serve({
    port: 39453,
    async fetch(candidate) {
      request = {
        url: candidate.url,
        method: candidate.method,
        authorization: candidate.headers.get("authorization"),
        body: await candidate.json() as {model?: string; messages?: unknown[]},
      };
      return Response.json({
        id: "chatcmpl-local",
        object: "chat.completion",
        created: 0,
        model: "local-model",
        choices: [{
          index: 0,
          message: {role: "assistant", content: "Hello from local provider"},
          finish_reason: "stop",
        }],
        usage: {prompt_tokens: 2, completion_tokens: 4, total_tokens: 6},
      });
    },
  });

  try {
    const response = await app.request("http://localhost/ai-local");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello from local provider");
    expect(request?.url).toBe("http://127.0.0.1:39453/v1/chat/completions");
    expect(request?.method).toBe("POST");
    expect(request?.authorization).toBe("Bearer local-test-key");
    expect(request?.body.model).toBe("local-model");
    expect(request?.body.messages).toEqual([{
      role: "user",
      content: "Say hello from the local provider",
    }]);
  } finally {
    provider.stop(true);
  }
});
