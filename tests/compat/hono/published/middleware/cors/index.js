var cors = (options) => {
  const opts = {
    origin: "*",
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
    allowHeaders: [],
    exposeHeaders: [],
    ...options
  };
  return async function cors2(c, next) {
    function set(key, value) {
      c.res.headers.set(key, value);
    }
    set("Access-Control-Allow-Origin", opts.origin);
    await next();
  };
};
export {
  cors
};
