import assert from "node:assert/strict";
import net from "node:net";

const waitTimeoutMs = positiveMilliseconds(process.env.TINYTSX_DEV_TEST_TIMEOUT_MS, 20_000);

export async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const {port} = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function waitForBody(port, expected, child, getOutput) {
  const deadline = Date.now() + waitTimeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      assert.fail(`dev process exited with ${child.exitCode}\n${getOutput()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      const body = await response.text();
      if (body === expected) return body;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${JSON.stringify(expected)}: ${lastError ?? "wrong body"}\n${getOutput()}`);
}

export async function waitForOutput(expected, child, getOutput) {
  const deadline = Date.now() + waitTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      assert.fail(`dev process exited with ${child.exitCode}\n${getOutput()}`);
    }
    if (getOutput().includes(expected)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for output ${JSON.stringify(expected)}\n${getOutput()}`);
}

export async function stopChild(child) {
  if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    new Promise(resolve => setTimeout(resolve, 2_000)),
  ]);
}

export function positiveMilliseconds(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
