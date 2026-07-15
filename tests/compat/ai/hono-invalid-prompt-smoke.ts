import {generateText} from "ai";
import {MockLanguageModelV4} from "ai/test";
import {Hono} from "hono";

const app = new Hono();

app.onError((error, context) => context.text(error.message, 500));
app.get("/ai-invalid", async context => {
  const model = new MockLanguageModelV4();
  // @ts-expect-error Deliberately violate the mutually exclusive prompt inputs.
  await generateText({
    model,
    prompt: "first prompt",
    messages: [{role: "user" as const, content: "second prompt"}],
  });
  return context.text("unexpected success");
});

export default app;
