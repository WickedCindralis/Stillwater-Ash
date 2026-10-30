import express, { type ErrorRequestHandler, type Express } from "express";
import path from "node:path";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";
import { getConfig, memoryRouter } from "./lib/ash/vector-memory-runtime.mjs";

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
app.use((req, res, next) => {
  let errorMessage: string | undefined;
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 400) {
      const error = typeof body === "object" && body !== null && "error" in body
        ? (body as { error?: unknown }).error
        : undefined;
      errorMessage = typeof error === "string" ? error : JSON.stringify(body);
    }
    return originalJson(body);
  }) as typeof res.json;

  res.on("finish", () => {
    if (res.statusCode >= 400) {
      logger.error(
        {
          url: req.originalUrl.split("?")[0],
          status: res.statusCode,
          error: errorMessage ?? res.statusMessage ?? "Request failed",
        },
        "HTTP request failed",
      );
    }
  });
  next();
});
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

app.use("/api/memory", (req, res, next) => {
  if (!req.session?.authenticated) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    // The memory module still validates its admin header; supply it server-side
    // only after Stillwater's existing login has authenticated this session.
    req.headers["x-memory-admin"] = getConfig().adminToken;
    next();
  } catch {
    res.status(503).json({ error: "Memory service is unavailable" });
  }
}, memoryRouter());
app.use("/api", router);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found" });
});
const apiErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const candidateStatus = typeof err === "object" && err !== null && "status" in err
    ? (err as { status?: unknown }).status
    : undefined;
  const status = typeof candidateStatus === "number" && candidateStatus >= 400 && candidateStatus < 600
    ? candidateStatus
    : 500;
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(status).json({ error: message });
};
app.use(apiErrorHandler);

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
