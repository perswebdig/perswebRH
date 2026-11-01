import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { protectedProcedure, router } from "../_core/trpc";
import { apiClients, webhooks } from "../../drizzle/schema";
import { hashPassword } from "../_core/password";
import {
  audit,
  canAdmin,
  database,
  requireActor,
  tenantAccess,
  tenantInput,
} from "./shared";

export const apiManagementRouter = router({
  listClients: protectedProcedure
    .input(tenantInput)
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await tenantAccess(db, user, input.tenantId, canAdmin);
      return db
        .select({
          id: apiClients.id,
          name: apiClients.name,
          clientId: apiClients.clientId,
          scopes: apiClients.scopes,
          active: apiClients.active,
          lastUsedAt: apiClients.lastUsedAt,
          createdAt: apiClients.createdAt,
        })
        .from(apiClients)
        .where(eq(apiClients.tenantId, input.tenantId));
    }),
  createClient: protectedProcedure
    .input(
      tenantInput.extend({
        name: z.string().trim().min(1).max(160),
        scopes: z.array(z.string().trim().min(1)).min(1).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      const clientId = `orc_${randomBytes(16).toString("hex")}`;
      const clientSecret = randomBytes(32).toString("base64url");
      const clientSecretHash = await hashPassword(clientSecret);
      const [id] = await db
        .insert(apiClients)
        .values({
          tenantId: input.tenantId,
          name: input.name,
          clientId,
          clientSecretHash,
          scopes: input.scopes,
          active: 1,
        })
        .$returningId();
      await audit(db, input.tenantId, actor.id, "api_client", id.id, "created");
      return { id: id.id, clientId, clientSecret };
    }),
  revokeClient: protectedProcedure
    .input(tenantInput.extend({ clientId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      await db
        .update(apiClients)
        .set({ active: 0 })
        .where(
          and(
            eq(apiClients.tenantId, input.tenantId),
            eq(apiClients.clientId, input.clientId)
          )
        );
      await audit(db, input.tenantId, actor.id, "api_client", null, "revoked");
      return { success: true };
    }),
  listWebhooks: protectedProcedure
    .input(tenantInput)
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await tenantAccess(db, user, input.tenantId, canAdmin);
      return db
        .select({
          id: webhooks.id,
          url: webhooks.url,
          events: webhooks.events,
          active: webhooks.active,
          createdAt: webhooks.createdAt,
        })
        .from(webhooks)
        .where(eq(webhooks.tenantId, input.tenantId));
    }),
  createWebhook: protectedProcedure
    .input(
      tenantInput.extend({
        url: z.string().url().max(500),
        events: z.array(z.string().min(1)).min(1).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      const secret = randomBytes(32).toString("base64url");
      const [id] = await db
        .insert(webhooks)
        .values({
          tenantId: input.tenantId,
          url: input.url,
          secretEncrypted: Buffer.from(secret).toString("base64"),
          events: input.events,
          active: 1,
        })
        .$returningId();
      await audit(db, input.tenantId, actor.id, "webhook", id.id, "created");
      return { id: id.id, secret };
    }),
});
