import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { ENV } from "./env";
import path from "node:path";
import { registerApiV1 } from "./apiV1";

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(self)"
    );
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    next();
  });
  // Receipt uploads are capped at 5 MiB in the tenant-authorized tRPC procedure.
  app.use(express.json({ limit: "8mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  app.get("/api/health", (_req, res) =>
    res.json({
      status: "ok",
      service: "perswebrh",
      authMode: ENV.authMode,
      storage: ENV.storageDriver,
      time: new Date().toISOString(),
    })
  );
  app.get("/local-storage/*", (req, res) => {
    const rel = String(req.path.replace(/^\/local-storage\//, ""));
    const root = path.resolve(process.cwd(), ENV.storageDir);
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(`${root}${path.sep}`))
      return res.status(403).end();
    res.sendFile(target, error => {
      if (error) res.status(404).end();
    });
  });
  registerApiV1(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  server.on("error", error => {
    console.error("Server failed:", error.message);
    process.exit(1);
  });
  server.listen(port, "0.0.0.0", () =>
    console.log(`Server listening on port ${port}`)
  );
}

startServer().catch(error => {
  console.error(error);
  process.exit(1);
});
