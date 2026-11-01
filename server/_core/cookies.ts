import type { CookieOptions, Request } from "express";
import { ENV } from "./env";

export function isSecureRequest(req: Request): boolean {
  const forwarded = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return (
    forwarded === "https" ||
    req.secure ||
    req.protocol === "https" ||
    ENV.isProduction
  );
}

export function getSessionCookieOptions(req: Request): CookieOptions {
  // Preview/production is public HTTPS in a cross-site frame even when the
  // upstream request is HTTP. Local self-hosted mode runs on HTTP and needs a
  // host-only, SameSite=Lax cookie so the browser stores the session.
  const localHttp = ENV.authMode === "local" && !isSecureRequest(req);
  return {
    httpOnly: true,
    path: "/",
    sameSite: localHttp ? "lax" : "none",
    secure: !localHttp,
  };
}
