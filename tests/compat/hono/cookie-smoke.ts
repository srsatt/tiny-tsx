// Closed setCookie cases from the pinned Hono cookie helper behavior tests.
import {Hono} from "hono";
import {getCookie, setCookie} from "hono/cookie";

const app = new Hono();

app.get("/set-cookie", context => {
  setCookie(context, "delicious_cookie", "macha");
  return context.text("Give cookie");
});

app.get("/a/set-cookie-path", context => {
  setCookie(context, "delicious_cookie", "macha", {path: "/a"});
  return context.text("Give cookie");
});

app.get("/get-cookie", context => context.text(
  getCookie(context, "delicious_cookie") ?? "missing",
));

export default app;
