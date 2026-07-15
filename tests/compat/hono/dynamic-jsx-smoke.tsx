import {Hono} from "hono";

const Greeting = (props: {name: string}) => (
  <main data-name={props.name}>Hello, <strong>{props.name}</strong>!</main>
);

const app = new Hono();
app.get("/dynamic", context => {
  const name = context.req.query("name") ?? "World";
  return context.html(<Greeting name={name} />);
});

export default app;
