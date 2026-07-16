import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("serves native generateText through a local OpenAI-compatible provider", async () => {
  const report = JSON.parse(await readFile(
    path.join(repository, "dist/ai-hono-provider.build.json"),
    "utf8",
  ));
  assert.equal(report.applicationWorkers, 1);
  assert.equal(report.providerWorkers, 1);
  assert.equal(report.providerTransport, true);
  assert.ok(report.runtimeFeatures.includes("bounded-provider-transport"));
  assert.equal(report.memory.managedHeapRequired, false);
  assert.equal(report.memory.summary.managed, 0);

  let captured;
  const provider = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    captured = {
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    };
    const body = JSON.stringify({
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
    response.writeHead(200, {"content-type": "application/json", "content-length": Buffer.byteLength(body)});
    response.end(body);
  });
  await new Promise((resolve, reject) => {
    provider.once("error", reject);
    provider.listen(39453, "127.0.0.1", resolve);
  });

  const binary = spawn(path.join(repository, "dist/ai-hono-provider"), [], {
    cwd: repository,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const response = await fetchWithRetry("http://127.0.0.1:39454/ai-local");
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "Hello from local provider");
    assert.deepEqual(captured, {
      method: "POST",
      url: "/v1/chat/completions",
      authorization: "Bearer local-test-key",
      body: {
        model: "local-model",
        messages: [{role: "user", content: "Say hello from the local provider"}],
      },
    });
  } finally {
    binary.kill("SIGTERM");
    await new Promise(resolve => binary.once("exit", resolve));
    await new Promise(resolve => provider.close(resolve));
  }
});

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw lastError;
}
