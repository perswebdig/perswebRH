import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import type { Express, Request, Response } from "express";
import { ENV } from "./env";
import { verifyPassword } from "./password";
import { getDb } from "../db";
import { apiClients, tenants } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const tokenSchema = z.object({
  grant_type: z.literal("client_credentials"),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  scope: z.string().optional(),
});

function secretKey() {
  if (!ENV.appSecret) throw new Error("APP_SECRET is unavailable");
  return new TextEncoder().encode(ENV.appSecret);
}

export async function issueAccessToken(payload: {
  clientId: string;
  tenantId: number;
  scopes: string[];
}) {
  return new SignJWT({
    clientId: payload.clientId,
    tenantId: payload.tenantId,
    scopes: payload.scopes,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secretKey());
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
  return payload as { clientId: string; tenantId: number; scopes: string[] };
}

export function registerApiV1(app: Express) {
  app.get("/api/v1/health", (_req, res) => {
    res.json({ status: "ok", version: "v1" });
  });

  app.get("/api/v1/openapi.json", (_req, res) => {
    res.json({
      openapi: "3.1.0",
      info: { title: "Pers Web RH API", version: "v1" },
      paths: {
        "/api/v1/health": { get: { summary: "Health check" } },
        "/api/v1/auth/token": {
          post: { summary: "Client credentials token" },
        },
        "/api/v1/tenants/current": {
          get: { summary: "Current tenant for the API client" },
        },
      },
    });
  });

  app.post("/api/v1/auth/token", async (req, res) => {
    const parsed = tokenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: "database_unavailable" });
      return;
    }
    const [client] = await db
      .select()
      .from(apiClients)
      .where(eq(apiClients.clientId, parsed.data.client_id))
      .limit(1);
    if (!client || !client.active) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }
    const valid = await verifyPassword(
      parsed.data.client_secret,
      client.clientSecretHash
    );
    if (!valid) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }
    const requestedScopes = parsed.data.scope
      ? parsed.data.scope.split(" ").filter(Boolean)
      : client.scopes;
    const scopes = requestedScopes.filter(scope => client.scopes.includes(scope));
    const accessToken = await issueAccessToken({
      clientId: client.clientId,
      tenantId: client.tenantId,
      scopes,
    });
    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: scopes.join(" "),
    });
  });

  const authMiddleware = async (req: Request, res: Response, next: () => void) => {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing_token" });
      return;
    }
    try {
      const token = header.slice(7);
      const payload = await verifyAccessToken(token);
      (req as Request & { apiAuth?: typeof payload }).apiAuth = payload;
      next();
    } catch {
      res.status(401).json({ error: "invalid_token" });
    }
  };

  app.get("/api/v1/tenants/current", authMiddleware, async (req, res) => {
    const auth = (req as Request & { apiAuth?: { tenantId: number; scopes: string[] } }).apiAuth;
    if (!auth?.scopes.includes("tenants:read")) {
      res.status(403).json({ error: "insufficient_scope" });
      return;
    }
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: "database_unavailable" });
      return;
    }
    const [tenant] = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        timezone: tenants.timezone,
        currency: tenants.currency,
      })
      .from(tenants)
      .where(eq(tenants.id, auth.tenantId))
      .limit(1);
    // need import tenants
    res.json({ tenant });
  });
}
