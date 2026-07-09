import express, { type Express } from "express";
import path from "node:path";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

if (!process.env["SESSION_SECRET"]) {
  throw new Error("SESSION_SECRET must be set");
}

const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "ash_session",
      createTableIfMissing: false,
    }),
    secret: process.env["SESSION_SECRET"],
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
    },
  }),
);

app.use("/api", router);

// When STATIC_DIR is set (e.g. Northflank single-service deployment), serve
// the built frontend and fall back to index.html for client-side routes.
const staticDir = process.env["STATIC_DIR"];
if (staticDir) {
  const resolved = path.resolve(staticDir);
  app.use(express.static(resolved));
  app.get(/^\/(?!api(\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(resolved, "index.html"));
  });
  logger.info({ staticDir: resolved }, "Serving static frontend");
}

export default app;
