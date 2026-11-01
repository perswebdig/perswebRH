import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Request, Response } from "express";
import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import { users, type User } from "../../drizzle/schema";
import { getSessionCookieOptions } from "../_core/cookies";
import { ENV } from "../_core/env";
import {
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
} from "../_core/password";
import {
  clearAttempts,
  consumeAttempt,
  loginAttemptKey,
} from "../_core/rateLimit";
import { sdk } from "../_core/sdk";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { database } from "./shared";

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(320)
  .transform(value => value.toLowerCase());
const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use ao menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  .max(MAX_PASSWORD_LENGTH);
const nameSchema = z.string().trim().min(1).max(160);

export type PublicUser = Omit<User, "passwordHash">;

export function publicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

async function openSession(res: Response, req: Request, user: User) {
  const token = await sdk.createSessionToken(user.openId, {
    name: user.name || "",
    expiresInMs: ONE_YEAR_MS,
  });
  res.cookie(COOKIE_NAME, token, {
    ...getSessionCookieOptions(req),
    maxAge: ONE_YEAR_MS,
  });
  return publicUser(user);
}

export const authRouter = router({
  mode: publicProcedure.query(() => ({
    localAuth: ENV.localAuthEnabled,
    registration: ENV.allowRegistration,
    oauth: false,
    appId: ENV.appId,
  })),
  me: publicProcedure.query(({ ctx }) =>
    ctx.user ? publicUser(ctx.user) : null
  ),
  register: publicProcedure
    .input(
      z.object({
        name: nameSchema,
        email: emailSchema,
        password: passwordSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ENV.localAuthEnabled)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "O cadastro local está desativado neste ambiente.",
        });
      if (!ENV.allowRegistration)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Novos cadastros estão desativados. Fale com o administrador.",
        });
      const attempt = consumeAttempt(
        loginAttemptKey(ctx.req, `register:${input.email}`)
      );
      if (!attempt.allowed)
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Muitas tentativas. Tente novamente em ${attempt.retryAfterSeconds}s.`,
        });
      const db = await database();
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      if (existing)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Já existe uma conta com este e-mail. Entre para continuar.",
        });
      const [{ total }] = await db.select({ total: count() }).from(users);
      const passwordHash = await hashPassword(input.password);
      let created: User;
      try {
        const [inserted] = await db
          .insert(users)
          .values({
            openId: `local_${randomUUID()}`,
            name: input.name,
            email: input.email,
            passwordHash,
            loginMethod: "password",
            role: total === 0 ? "admin" : "user",
            lastSignedIn: new Date(),
          })
          .$returningId();
        const [row] = await db
          .select()
          .from(users)
          .where(eq(users.id, inserted.id))
          .limit(1);
        created = row;
      } catch {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Não foi possível criar a conta com estes dados.",
        });
      }
      clearAttempts(loginAttemptKey(ctx.req, `register:${input.email}`));
      return openSession(ctx.res, ctx.req, created);
    }),
  login: publicProcedure
    .input(z.object({ email: emailSchema, password: passwordSchema }))
    .mutation(async ({ ctx, input }) => {
      if (!ENV.localAuthEnabled)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "A entrada por e-mail está desativada neste ambiente.",
        });
      const key = loginAttemptKey(ctx.req, input.email);
      const attempt = consumeAttempt(key);
      if (!attempt.allowed)
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Muitas tentativas. Tente novamente em ${attempt.retryAfterSeconds}s.`,
        });
      const db = await database();
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);
      const valid =
        Boolean(user) && (await verifyPassword(input.password, user?.passwordHash));
      if (!user || !valid)
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "E-mail ou senha incorretos.",
        });
      await db
        .update(users)
        .set({ lastSignedIn: new Date() })
        .where(eq(users.id, user.id));
      clearAttempts(key);
      return openSession(ctx.res, ctx.req, user);
    }),
  updateProfile: protectedProcedure
    .input(z.object({ name: nameSchema }))
    .mutation(async ({ ctx, input }) => {
      const db = await database();
      await db
        .update(users)
        .set({ name: input.name })
        .where(eq(users.id, ctx.user.id));
      const [updated] = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);
      return publicUser(updated);
    }),
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().max(MAX_PASSWORD_LENGTH).optional(),
        newPassword: passwordSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await database();
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
      if (user.passwordHash) {
        const valid = await verifyPassword(
          input.currentPassword ?? "",
          user.passwordHash
        );
        if (!valid)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A senha atual não confere.",
          });
      }
      const passwordHash = await hashPassword(input.newPassword);
      await db
        .update(users)
        .set({ passwordHash, loginMethod: "password" })
        .where(eq(users.id, user.id));
      return { success: true };
    }),
  logout: publicProcedure.mutation(({ ctx }) => {
    const options = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...options, maxAge: -1 });
    return { success: true } as const;
  }),
});
