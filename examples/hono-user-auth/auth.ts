import {basicAuth} from "hono/basic-auth";

export const accountGuard = basicAuth({
  username: "admin",
  password: "tinytsx",
  realm: "TinyTSX Account",
});

