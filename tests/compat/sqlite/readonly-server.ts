import {Hono} from "hono";
import {openReadonlyDatabase} from "tinytsx:sqlite";

const database = openReadonlyDatabase("AIR_DB");
const readings = database.prepare(
  "SELECT recorded_at, co2, temperature, humidity FROM readings ORDER BY recorded_at",
);
const app = new Hono();

app.get("/readings", async context => context.json({readings: await readings.all()}));

export default app;
