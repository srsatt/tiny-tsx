import {Hono} from "hono";
import {openReadonlyDatabase} from "tinytsx:sqlite";

const database = openReadonlyDatabase("AIR_DB");
const readings = database.prepare(
  "SELECT recorded_at, co2, temperature, humidity FROM readings ORDER BY recorded_at",
);
const history = database.prepare(
  "SELECT recorded_at, co2 FROM readings WHERE recorded_at >= CAST(?1 AS INTEGER) ORDER BY recorded_at LIMIT 256",
);
const app = new Hono();

app.get("/readings", async context => context.json({readings: await readings.all()}));
app.get("/history", async context => context.json({
  readings: await history.all([context.req.query("since") ?? "0"]),
}));

export default app;
