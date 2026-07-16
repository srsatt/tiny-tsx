const port = Number.parseInt(Bun.env.TINYTSX_PROVIDER_PORT ?? "39453", 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("TINYTSX_PROVIDER_PORT must be a valid TCP port");
}

Bun.serve({
  hostname: "127.0.0.1",
  port,
  development: false,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("ok");
    }
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return new Response("not found", {status: 404});
    }
    if (request.headers.get("authorization") !== "Bearer local-test-key") {
      return new Response("unauthorized", {status: 401});
    }
    const body = await request.json() as {
      model?: string;
      messages?: Array<{role?: string; content?: string}>;
    };
    if (
      body.model !== "local-model"
      || body.messages?.[0]?.role !== "user"
      || body.messages[0].content !== "Say hello from the local provider"
    ) {
      return new Response("invalid request", {status: 400});
    }
    return Response.json({
      id: "chatcmpl-benchmark",
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
