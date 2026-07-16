import {serve} from "@hono/node-server";
import {Hono} from "hono";
import {readTextFile} from "tinytsx:fs";
import {poweredBy} from "hono/powered-by";

const app = new Hono();

app.use("*", poweredBy());

app.get("/", context => context.html(
  `<html lang="en">
    <head>
    <title>Hono</title>
  </head>
    <body>
      <h1>Welcome to Hono</h1>
      <p>
        Try visiting: <a href="/my-file.txt">/my-file.txt</a> and <a href="/folder/nested-file.txt">/folder/nested-file.txt</a>
      </p>
      <p>
        Learn more about serving static files in Hono <a target="_blank" href="https://hono.dev/docs/getting-started/cloudflare-workers#serve-static-files">here</a>
      </p>
    </body>
  </html>`,
));
app.get("/my-file.txt", async context => context.text(await readTextFile("my-file.txt")));
app.get("/folder/nested-file.txt", async context => context.text(
  await readTextFile("folder/nested-file.txt"),
));
app.get("/missing.txt", async context => context.text(await readTextFile("missing.txt")));
app.get("/too-small", async context => context.text(
  await readTextFile("my-file.txt", {maxBytes: 1}),
));

serve({fetch: app.fetch});
