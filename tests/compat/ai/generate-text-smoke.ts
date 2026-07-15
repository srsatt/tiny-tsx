import {generateText} from "ai";

export async function generateDeterministicText(model: unknown): Promise<string> {
  const result = await generateText({
    model: model as never,
    prompt: "Say hello",
  });
  return result.text;
}
