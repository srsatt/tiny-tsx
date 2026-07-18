import {Consumer} from "@hono/stytch-auth";
import {Hono} from "hono";

const app = new Hono<{Bindings: Env}>();

app.get("/session/local", Consumer.authenticateSessionLocal(), context => {
  const {user_id} = Consumer.getStytchSession(context);
  return context.text(`local:${user_id}`);
});

app.post("/session/remote", Consumer.authenticateSessionRemote(), context => {
  const {user_id} = Consumer.getStytchSession(context);
  return context.text(`remote:${user_id}`);
});

export default app;
