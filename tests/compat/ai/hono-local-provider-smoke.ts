import {createOpenAICompatible} from "@ai-sdk/openai-compatible";
import {generateText} from "ai";
import {Hono} from "hono";

const local = createOpenAICompatible({
  name: "local",
  baseURL: "http://127.0.0.1:39453/v1",
  apiKey: "local-test-key",
});
const app = new Hono();

app.get("/ai-local", async context => {
  const result = await generateText({
    model: local("local-model"),
    prompt: "Say hello from the local provider",
  });
  return context.text(result.text);
});

export default app;
