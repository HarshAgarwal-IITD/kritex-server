import "dotenv/config";
import express from "express";
import cors from "cors";
import { queriesRouter } from "./routes/queries.js";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 4000;

const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:8080")
  .split(",")
  .map((origin) => origin.trim());

app.use(cors({ origin: corsOrigins }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/queries", queriesRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(port, () => {
  console.log(`kritex-server listening on http://localhost:${port}`);
});
