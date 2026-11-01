import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  signatureEvents,
  signatureRequests,
  signatureSigners,
} from "../../drizzle/schema";
import {
  audit,
  canAdmin,
  database,
  idSchema,
  requireActor,
  tenantAccess,
  tenantInput,
} from "./shared";

export const signaturesRouter = router({
  list: protectedProcedure
    .input(tenantInput)
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await tenantAccess(db, user, input.tenantId);
      return db
        .select()
        .from(signatureRequests)
        .where(eq(signatureRequests.tenantId, input.tenantId))
        .orderBy(eq(signatureRequests.id, signatureRequests.id));
    }),
  create: protectedProcedure
    .input(
      tenantInput.extend({
        documentType: z.string().trim().min(1).max(80),
        documentId: idSchema.optional(),
        signers: z.array(z.string().email()).min(1).max(20),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      const [request] = await db
        .insert(signatureRequests)
        .values({
          tenantId: input.tenantId,
          documentType: input.documentType,
          documentId: input.documentId ?? null,
          status: "pending",
          provider: "internal",
        })
        .$returningId();
      for (const [index, email] of input.signers.entries()) {
        await db.insert(signatureSigners).values({
          requestId: request.id,
          email,
          signerOrder: index + 1,
          status: "pending",
        });
      }
      await db.insert(signatureEvents).values({
        requestId: request.id,
        event: "created",
        metadata: { createdBy: actor.id },
      });
      await audit(db, input.tenantId, actor.id, "signature", request.id, "created");
      return { id: request.id };
    }),
  updateSigner: protectedProcedure
    .input(
      tenantInput.extend({
        requestId: idSchema,
        signerId: idSchema,
        status: z.enum(["signed", "rejected"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await tenantAccess(db, user, input.tenantId, canAdmin);
      await db
        .update(signatureSigners)
        .set({
          status: input.status,
          signedAt: input.status === "signed" ? new Date() : null,
        })
        .where(eq(signatureSigners.id, input.signerId));
      await db.insert(signatureEvents).values({
        requestId: input.requestId,
        event: input.status,
        metadata: { signerId: input.signerId },
      });
      return { success: true };
    }),
});
