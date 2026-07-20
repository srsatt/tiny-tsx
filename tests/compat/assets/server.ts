import {Hono} from "hono";
import {openAssets} from "tinytsx:assets";

const assets = openAssets("WEB", {index: "index.html", spaFallback: true});
const app = new Hono();

app.get("*", context => assets.fetch(context.req));

export default app;
