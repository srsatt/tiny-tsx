import {Hono} from "hono";
import {poweredBy} from "hono/powered-by";
import {secureHeaders} from "hono/secure-headers";

const app = new Hono();

app.use("/default/*", poweredBy());
app.use("/default/*", secureHeaders());
app.get("/default", context => context.text("default"));

app.use("/ordered/*", secureHeaders());
app.use("/ordered/*", poweredBy());
app.get("/ordered", context => context.text("ordered"));

app.use("/custom/*", secureHeaders({
  strictTransportSecurity: "max-age=31536000; includeSubDomains; preload;",
  xFrameOptions: "DENY",
  xXssProtection: false,
  removePoweredBy: false,
}));
app.get("/custom", context => context.text("custom"));

export default app;
