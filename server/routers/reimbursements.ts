import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { buildSimplePdf } from "../_core/pdf";
import { storageDelete, storagePut, storageRead } from "../storage";
import {
  approvalRules,
  approvalSteps,
  departments,
  expenseAttachments,
  expenseCategories,
  expenseItems,
  memberships,
  reimbursements,
  tenantAuditLogs,
  tenants,
  users,
  workEntries,
  workPeriods,
  workSettings,
  type User,
} from "../../drizzle/schema";
import {
  audit,
  canAdmin,
  canManage,
  chooseApprovers,
  dateInTimezone,
  database,
  decryptReceipt,
  encryptReceipt,
  idSchema,
  monthBounds,
  money,
  optionalText,
  periodFor,
  requireActor,
  roles,
  tenantAccess,
  tenantInput,
  textField,
  totalsFor,
  weekBounds,
  weekdaysBetween,
  workEntryHours,
} from "./shared";

export const reimbursementsRouter = router({
  list: protectedProcedure.input(tenantInput).query(async ({ ctx, input }) => {
    const user = requireActor(ctx.user);
    const db = await database();
    const member = await tenantAccess(db, user, input.tenantId);
    const requestRows =
      member.role === "tenant_admin"
        ? await db
            .select()
            .from(reimbursements)
            .where(eq(reimbursements.tenantId, input.tenantId))
            .orderBy(desc(reimbursements.createdAt))
        : await db
            .select()
            .from(reimbursements)
            .where(
              and(
                eq(reimbursements.tenantId, input.tenantId),
                or(
                  eq(reimbursements.membershipId, member.id),
                  eq(reimbursements.currentApproverMembershipId, member.id),
                  eq(reimbursements.paymentMembershipId, member.id)
                )
              )
            )
            .orderBy(desc(reimbursements.createdAt));
    const employeeIds = Array.from(
      new Set(requestRows.map(row => row.membershipId))
    );
    const employeeRows = employeeIds.length
      ? await db
          .select({
            id: memberships.id,
            name: memberships.name,
            departmentId: memberships.departmentId,
          })
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, input.tenantId),
              inArray(memberships.id, employeeIds)
            )
          )
      : [];
    const requestIds = requestRows.map(row => row.id);
    const itemRows = requestIds.length
      ? await db
          .select({
            item: expenseItems,
            categoryName: expenseCategories.name,
          })
          .from(expenseItems)
          .innerJoin(
            expenseCategories,
            and(
              eq(expenseItems.categoryId, expenseCategories.id),
              eq(expenseCategories.tenantId, input.tenantId)
            )
          )
          .where(
            and(
              eq(expenseItems.tenantId, input.tenantId),
              inArray(expenseItems.reimbursementId, requestIds)
            )
          )
      : [];
    return requestRows.map(request => ({
      ...request,
      canAct:
        member.role === "tenant_admin" ||
        request.currentApproverMembershipId === member.id,
      canPay:
        member.role === "tenant_admin" ||
        request.paymentMembershipId === member.id,
      employee:
        employeeRows.find(row => row.id === request.membershipId) ?? null,
      items: itemRows
        .filter(row => row.item.reimbursementId === request.id)
        .map(row => ({ ...row.item, categoryName: row.categoryName })),
    }));
  }),
  createDraft: protectedProcedure
    .input(tenantInput.extend({ title: textField(180) }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [id] = await db
        .insert(reimbursements)
        .values({
          tenantId: input.tenantId,
          membershipId: member.id,
          title: input.title,
        })
        .$returningId();
      await audit(
        db,
        input.tenantId,
        member.id,
        "reimbursement",
        id.id,
        "draft_created"
      );
      return { id: id.id };
    }),
  addItem: protectedProcedure
    .input(
      tenantInput.extend({
        reimbursementId: idSchema,
        categoryId: idSchema,
        description: textField(240),
        amount: z.number().positive().max(100000000),
        expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [request] = await db
        .select()
        .from(reimbursements)
        .where(
          and(
            eq(reimbursements.id, input.reimbursementId),
            eq(reimbursements.tenantId, input.tenantId),
            eq(reimbursements.membershipId, member.id)
          )
        )
        .limit(1);
      if (!request || request.status !== "draft")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Somente rascunhos próprios podem ser alterados.",
        });
      const [category] = await db
        .select()
        .from(expenseCategories)
        .where(
          and(
            eq(expenseCategories.id, input.categoryId),
            eq(expenseCategories.tenantId, input.tenantId),
            eq(expenseCategories.active, 1)
          )
        )
        .limit(1);
      if (!category)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Categoria não disponível para esta empresa.",
        });
      const priorCategoryItems = await db
        .select({ amount: expenseItems.amount })
        .from(expenseItems)
        .where(
          and(
            eq(expenseItems.tenantId, input.tenantId),
            eq(expenseItems.reimbursementId, input.reimbursementId),
            eq(expenseItems.categoryId, input.categoryId)
          )
        );
      const categoryTotal =
        priorCategoryItems.reduce((sum, row) => sum + Number(row.amount), 0) +
        input.amount;
      if (category.limitAmount && categoryTotal > Number(category.limitAmount))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `O total desta categoria na solicitação excede o limite de R$ ${Number(category.limitAmount).toFixed(2)}.`,
        });
      const [item] = await db
        .insert(expenseItems)
        .values({
          tenantId: input.tenantId,
          reimbursementId: input.reimbursementId,
          categoryId: input.categoryId,
          description: input.description,
          amount: money(input.amount),
          expenseDate: input.expenseDate,
        })
        .$returningId();
      const totalAmount = await totalsFor(
        db,
        input.tenantId,
        input.reimbursementId
      );
      await db
        .update(reimbursements)
        .set({ totalAmount })
        .where(
          and(
            eq(reimbursements.id, input.reimbursementId),
            eq(reimbursements.tenantId, input.tenantId)
          )
        );
      await audit(
        db,
        input.tenantId,
        member.id,
        "expense_item",
        item.id,
        "created",
        { amount: input.amount }
      );
      return { id: item.id, totalAmount };
    }),
  uploadReceipt: protectedProcedure
    .input(
      tenantInput.extend({
        reimbursementId: idSchema,
        itemId: idSchema.nullable().optional(),
        fileName: textField(255),
        contentType: z.enum([
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/pdf",
        ]),
        dataBase64: z.string().min(1).max(7_200_000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [request] = await db
        .select()
        .from(reimbursements)
        .where(
          and(
            eq(reimbursements.id, input.reimbursementId),
            eq(reimbursements.tenantId, input.tenantId),
            eq(reimbursements.membershipId, member.id)
          )
        )
        .limit(1);
      if (!request || request.status !== "draft")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Anexos só podem ser incluídos em rascunhos próprios.",
        });
      if (input.itemId != null) {
        const [item] = await db
          .select({ id: expenseItems.id })
          .from(expenseItems)
          .where(
            and(
              eq(expenseItems.id, input.itemId),
              eq(expenseItems.tenantId, input.tenantId),
              eq(expenseItems.reimbursementId, request.id)
            )
          )
          .limit(1);
        if (!item)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "O comprovante deve pertencer a um item desta solicitação.",
          });
      }
      const data = Buffer.from(input.dataBase64, "base64");
      if (!data.length || data.length > 5 * 1024 * 1024)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "O arquivo deve ter até 5 MB.",
        });
      const signatureValid =
        (input.contentType === "application/pdf" &&
          data.subarray(0, 5).toString("ascii") === "%PDF-") ||
        (input.contentType === "image/jpeg" &&
          data[0] === 0xff &&
          data[1] === 0xd8 &&
          data[2] === 0xff) ||
        (input.contentType === "image/png" &&
          data
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (input.contentType === "image/webp" &&
          data.subarray(0, 4).toString("ascii") === "RIFF" &&
          data.subarray(8, 12).toString("ascii") === "WEBP");
      if (!signatureValid)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "O conteúdo do arquivo não corresponde ao formato informado.",
        });
      const safeName =
        input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) ||
        "recibo";
      const key = `tenants/${input.tenantId}/reimbursements/${request.id}/${crypto.randomUUID()}-${safeName}`;
      const encrypted = encryptReceipt(data);
      const stored = await storagePut(
        key,
        encrypted,
        "application/octet-stream"
      );
      await db.insert(expenseAttachments).values({
        tenantId: input.tenantId,
        reimbursementId: request.id,
        itemId: input.itemId ?? null,
        uploadedByMembershipId: member.id,
        objectKey: stored.key,
        originalName: safeName,
        contentType: input.contentType,
        sizeBytes: data.length,
      });
      await audit(
        db,
        input.tenantId,
        member.id,
        "expense_attachment",
        request.id,
        "uploaded",
        { name: safeName, sizeBytes: data.length }
      );
      return { name: safeName, sizeBytes: data.length };
    }),
  submit: protectedProcedure
    .input(tenantInput.extend({ reimbursementId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [request] = await db
        .select()
        .from(reimbursements)
        .where(
          and(
            eq(reimbursements.id, input.reimbursementId),
            eq(reimbursements.tenantId, input.tenantId),
            eq(reimbursements.membershipId, member.id)
          )
        )
        .limit(1);
      if (!request || request.status !== "draft")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Somente rascunhos próprios podem ser enviados.",
        });
      const itemRows = await db
        .select()
        .from(expenseItems)
        .where(
          and(
            eq(expenseItems.tenantId, input.tenantId),
            eq(expenseItems.reimbursementId, request.id)
          )
        );
      if (!itemRows.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Inclua ao menos uma despesa antes de enviar.",
        });
      const categoryIds = Array.from(
        new Set(itemRows.map(item => item.categoryId))
      );
      const [owner] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.id, member.id),
            eq(memberships.tenantId, input.tenantId)
          )
        )
        .limit(1);
      const total = itemRows.reduce(
        (sum, item) => sum + Number(item.amount),
        0
      );
      const approverId = await chooseApprovers(
        db,
        input.tenantId,
        request.id,
        owner,
        total,
        categoryIds
      );
      await db
        .update(reimbursements)
        .set({
          status: "submitted",
          totalAmount: total.toFixed(2),
          submittedAt: new Date(),
          currentApproverMembershipId: approverId,
        })
        .where(
          and(
            eq(reimbursements.id, request.id),
            eq(reimbursements.tenantId, input.tenantId)
          )
        );
      await audit(
        db,
        input.tenantId,
        member.id,
        "reimbursement",
        request.id,
        "submitted",
        { total: total.toFixed(2) }
      );
      await db
        .update(reimbursements)
        .set({ status: "in_approval" })
        .where(
          and(
            eq(reimbursements.id, request.id),
            eq(reimbursements.tenantId, input.tenantId),
            eq(reimbursements.status, "submitted")
          )
        );
      await audit(
        db,
        input.tenantId,
        member.id,
        "reimbursement",
        request.id,
        "in_approval"
      );
      return { success: true };
    }),
  decide: protectedProcedure
    .input(
      tenantInput.extend({
        reimbursementId: idSchema,
        decision: z.enum(["approved", "rejected"]),
        note: optionalText(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, [
        "tenant_admin",
        "manager",
        "finance",
        "administrative",
      ]);
      const [request] = await db
        .select()
        .from(reimbursements)
        .where(
          and(
            eq(reimbursements.id, input.reimbursementId),
            eq(reimbursements.tenantId, input.tenantId),
            eq(reimbursements.status, "in_approval")
          )
        )
        .limit(1);
      if (!request)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitação em aprovação não encontrada.",
        });
      if (
        actor.role !== "tenant_admin" &&
        request.currentApproverMembershipId !== actor.id
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Esta solicitação está atribuída a outro responsável.",
        });
      if (input.decision === "rejected" && !input.note?.trim())
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Informe a justificativa da rejeição.",
        });
      const [step] = await db
        .select()
        .from(approvalSteps)
        .where(
          and(
            eq(approvalSteps.tenantId, input.tenantId),
            eq(approvalSteps.reimbursementId, request.id),
            eq(approvalSteps.status, "pending")
          )
        )
        .orderBy(asc(approvalSteps.sequence))
        .limit(1);
      if (step)
        await db
          .update(approvalSteps)
          .set({
            status: input.decision,
            note: input.note ?? null,
            decidedAt: new Date(),
          })
          .where(
            and(
              eq(approvalSteps.id, step.id),
              eq(approvalSteps.tenantId, input.tenantId)
            )
          );
      if (input.decision === "rejected") {
        await db
          .update(approvalSteps)
          .set({ status: "skipped" })
          .where(
            and(
              eq(approvalSteps.tenantId, input.tenantId),
              eq(approvalSteps.reimbursementId, request.id),
              eq(approvalSteps.status, "pending")
            )
          );
        await db
          .update(reimbursements)
          .set({
            status: "rejected",
            rejectionReason: input.note,
            currentApproverMembershipId: null,
            paymentMembershipId: null,
          })
          .where(
            and(
              eq(reimbursements.id, request.id),
              eq(reimbursements.tenantId, input.tenantId)
            )
          );
      } else {
        const [next] = await db
          .select()
          .from(approvalSteps)
          .where(
            and(
              eq(approvalSteps.tenantId, input.tenantId),
              eq(approvalSteps.reimbursementId, request.id),
              eq(approvalSteps.status, "pending")
            )
          )
          .orderBy(asc(approvalSteps.sequence))
          .limit(1);
        if (next)
          await db
            .update(reimbursements)
            .set({ currentApproverMembershipId: next.approverMembershipId })
            .where(
              and(
                eq(reimbursements.id, request.id),
                eq(reimbursements.tenantId, input.tenantId)
              )
            );
        else
          await db
            .update(reimbursements)
            .set({
              status: "approved",
              approvedAt: new Date(),
              currentApproverMembershipId: null,
              paymentMembershipId: actor.id,
            })
            .where(
              and(
                eq(reimbursements.id, request.id),
                eq(reimbursements.tenantId, input.tenantId)
              )
            );
      }
      await audit(
        db,
        input.tenantId,
        actor.id,
        "reimbursement",
        request.id,
        input.decision,
        { note: input.note ?? null }
      );
      return { success: true };
    }),
  markPaid: protectedProcedure
    .input(
      tenantInput.extend({
        reimbursementId: idSchema,
        paymentReference: z.string().trim().max(160).nullable().optional(),
        paymentNote: z.string().trim().max(2000).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId);
      const [request] = await db
        .select()
        .from(reimbursements)
        .where(
          and(
            eq(reimbursements.id, input.reimbursementId),
            eq(reimbursements.tenantId, input.tenantId),
            eq(reimbursements.status, "approved")
          )
        )
        .limit(1);
      if (!request)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Somente solicitações aprovadas podem ser pagas.",
        });
      if (
        actor.role !== "tenant_admin" &&
        request.paymentMembershipId !== actor.id
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Esta solicitação está atribuída a outro responsável pelo pagamento.",
        });
      await db
        .update(reimbursements)
        .set({
          status: "paid",
          paidAt: new Date(),
          paymentReference: input.paymentReference || null,
          paymentNote: input.paymentNote || null,
        })
        .where(
          and(
            eq(reimbursements.id, request.id),
            eq(reimbursements.tenantId, input.tenantId)
          )
        );
      await audit(
        db,
        input.tenantId,
        actor.id,
        "reimbursement",
        request.id,
        "paid"
      );
      return { success: true };
    }),
  detail: protectedProcedure
    .input(tenantInput.extend({ reimbursementId: idSchema }))
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [request] = await db
        .select()
        .from(reimbursements)
        .where(
          and(
            eq(reimbursements.id, input.reimbursementId),
            eq(reimbursements.tenantId, input.tenantId)
          )
        )
        .limit(1);
      if (!request) throw new TRPCError({ code: "NOT_FOUND" });
      const paymentAccess = request.paymentMembershipId === member.id;
      if (
        request.membershipId !== member.id &&
        request.currentApproverMembershipId !== member.id &&
        member.role !== "tenant_admin" &&
        !paymentAccess
      )
        throw new TRPCError({ code: "FORBIDDEN" });
      const [items, attachments, steps] = await Promise.all([
        db
          .select({
            item: expenseItems,
            categoryName: expenseCategories.name,
          })
          .from(expenseItems)
          .innerJoin(
            expenseCategories,
            and(
              eq(expenseItems.categoryId, expenseCategories.id),
              eq(expenseCategories.tenantId, input.tenantId)
            )
          )
          .where(
            and(
              eq(expenseItems.tenantId, input.tenantId),
              eq(expenseItems.reimbursementId, request.id)
            )
          ),
        db
          .select()
          .from(expenseAttachments)
          .where(
            and(
              eq(expenseAttachments.tenantId, input.tenantId),
              eq(expenseAttachments.reimbursementId, request.id)
            )
          )
          .orderBy(asc(expenseAttachments.createdAt)),
        db
          .select()
          .from(approvalSteps)
          .where(
            and(
              eq(approvalSteps.tenantId, input.tenantId),
              eq(approvalSteps.reimbursementId, request.id)
            )
          )
          .orderBy(asc(approvalSteps.sequence)),
      ]);
      return {
        request,
        items: items.map(row => ({
          ...row.item,
          categoryName: row.categoryName,
        })),
        attachments: attachments.map(file => ({
          id: file.id,
          name: file.originalName,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
        })),
        steps,
      };
    }),
  updateItem: protectedProcedure
    .input(
      tenantInput.extend({
        itemId: idSchema,
        categoryId: idSchema,
        description: textField(240),
        amount: z.number().positive().max(100000000),
        expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [item] = await db
        .select()
        .from(expenseItems)
        .where(
          and(
            eq(expenseItems.id, input.itemId),
            eq(expenseItems.tenantId, input.tenantId)
          )
        )
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      const [request] = await db
        .select()
        .from(reimbursements)
        .where(
          and(
            eq(reimbursements.id, item.reimbursementId),
            eq(reimbursements.tenantId, input.tenantId),
            eq(reimbursements.membershipId, member.id),
            eq(reimbursements.status, "draft")
          )
        )
        .limit(1);
      if (!request)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Somente itens de rascunhos próprios podem ser alterados.",
        });
      const [category] = await db
        .select()
        .from(expenseCategories)
        .where(
          and(
            eq(expenseCategories.id, input.categoryId),
            eq(expenseCategories.tenantId, input.tenantId),
            eq(expenseCategories.active, 1)
          )
        )
        .limit(1);
      if (!category)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Categoria não disponível para esta empresa.",
        });
      const siblings = await db
        .select({ id: expenseItems.id, amount: expenseItems.amount })
        .from(expenseItems)
        .where(
          and(
            eq(expenseItems.tenantId, input.tenantId),
            eq(expenseItems.reimbursementId, request.id),
            eq(expenseItems.categoryId, input.categoryId)
          )
        );
      const categoryTotal =
        siblings
          .filter(row => row.id !== item.id)
          .reduce((sum, row) => sum + Number(row.amount), 0) + input.amount;
      if (category.limitAmount && categoryTotal > Number(category.limitAmount))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `O total desta categoria na solicitação excede o limite de R$ ${Number(category.limitAmount).toFixed(2)}.`,
        });
      await db
        .update(expenseItems)
        .set({
          categoryId: input.categoryId,
          description: input.description,
          amount: money(input.amount),
          expenseDate: input.expenseDate,
        })
        .where(
          and(
            eq(expenseItems.id, item.id),
            eq(expenseItems.tenantId, input.tenantId)
          )
        );
      const totalAmount = await totalsFor(
        db,
        input.tenantId,
        request.id
      );
      await db
        .update(reimbursements)
        .set({ totalAmount })
        .where(
          and(
            eq(reimbursements.id, request.id),
            eq(reimbursements.tenantId, input.tenantId)
          )
        );
      await audit(
        db,
        input.tenantId,
        member.id,
        "expense_item",
        item.id,
        "updated"
      );
      return { success: true, totalAmount };
    }),
  deleteItem: protectedProcedure
    .input(tenantInput.extend({ itemId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [item] = await db
        .select()
        .from(expenseItems)
        .where(
          and(
            eq(expenseItems.id, input.itemId),
            eq(expenseItems.tenantId, input.tenantId)
          )
        )
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      const [request] = await db
        .select()
        .from(reimbursements)
        .where(
          and(
            eq(reimbursements.id, item.reimbursementId),
            eq(reimbursements.tenantId, input.tenantId),
            eq(reimbursements.membershipId, member.id),
            eq(reimbursements.status, "draft")
          )
        )
        .limit(1);
      if (!request)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Somente itens de rascunhos próprios podem ser removidos.",
        });
      await db
        .delete(expenseItems)
        .where(
          and(
            eq(expenseItems.id, item.id),
            eq(expenseItems.tenantId, input.tenantId)
          )
        );
      const totalAmount = await totalsFor(db, input.tenantId, request.id);
      await db
        .update(reimbursements)
        .set({ totalAmount })
        .where(
          and(
            eq(reimbursements.id, request.id),
            eq(reimbursements.tenantId, input.tenantId)
          )
        );
      await audit(
        db,
        input.tenantId,
        member.id,
        "expense_item",
        item.id,
        "deleted"
      );
      return { success: true, totalAmount };
    }),
  deleteReceipt: protectedProcedure
    .input(tenantInput.extend({ attachmentId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [attachment] = await db
        .select()
        .from(expenseAttachments)
        .where(
          and(
            eq(expenseAttachments.id, input.attachmentId),
            eq(expenseAttachments.tenantId, input.tenantId)
          )
        )
        .limit(1);
      if (!attachment) throw new TRPCError({ code: "NOT_FOUND" });
      const [request] = await db
        .select()
        .from(reimbursements)
        .where(
          and(
            eq(reimbursements.id, attachment.reimbursementId),
            eq(reimbursements.tenantId, input.tenantId),
            eq(reimbursements.membershipId, member.id),
            eq(reimbursements.status, "draft")
          )
        )
        .limit(1);
      if (!request)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Somente recibos de rascunhos próprios podem ser removidos.",
        });
      await db
        .delete(expenseAttachments)
        .where(
          and(
            eq(expenseAttachments.id, attachment.id),
            eq(expenseAttachments.tenantId, input.tenantId)
          )
        );
      await storageDelete(attachment.objectKey);
      await audit(
        db,
        input.tenantId,
        member.id,
        "expense_attachment",
        attachment.id,
        "deleted"
      );
      return { success: true };
    }),
  deleteDraft: protectedProcedure
    .input(tenantInput.extend({ reimbursementId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [request] = await db
        .select()
        .from(reimbursements)
        .where(
          and(
            eq(reimbursements.id, input.reimbursementId),
            eq(reimbursements.tenantId, input.tenantId),
            eq(reimbursements.membershipId, member.id),
            eq(reimbursements.status, "draft")
          )
        )
        .limit(1);
      if (!request)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Somente rascunhos próprios podem ser excluídos.",
        });
      const attachments = await db
        .select({ objectKey: expenseAttachments.objectKey })
        .from(expenseAttachments)
        .where(
          and(
            eq(expenseAttachments.tenantId, input.tenantId),
            eq(expenseAttachments.reimbursementId, request.id)
          )
        );
      await db
        .delete(reimbursements)
        .where(
          and(
            eq(reimbursements.id, request.id),
            eq(reimbursements.tenantId, input.tenantId)
          )
        );
      await Promise.all(
        attachments.map(file => storageDelete(file.objectKey))
      );
      await audit(
        db,
        input.tenantId,
        member.id,
        "reimbursement",
        request.id,
        "draft_deleted"
      );
      return { success: true };
    }),
  generatePdf: protectedProcedure
    .input(tenantInput.extend({ reimbursementId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [request] = await db
        .select()
        .from(reimbursements)
        .where(
          and(
            eq(reimbursements.id, input.reimbursementId),
            eq(reimbursements.tenantId, input.tenantId)
          )
        )
        .limit(1);
      if (!request) throw new TRPCError({ code: "NOT_FOUND" });
      const items = await db
        .select({
          description: expenseItems.description,
          categoryName: expenseCategories.name,
          amount: expenseItems.amount,
          expenseDate: expenseItems.expenseDate,
        })
        .from(expenseItems)
        .innerJoin(
          expenseCategories,
          and(
            eq(expenseItems.categoryId, expenseCategories.id),
            eq(expenseCategories.tenantId, input.tenantId)
          )
        )
        .where(
          and(
            eq(expenseItems.tenantId, input.tenantId),
            eq(expenseItems.reimbursementId, request.id)
          )
        );
      const lines = [
        `Pers Web RH - Nota consolidada #${request.id}`,
        `Titulo: ${request.title}`,
        `Status: ${request.status}`,
        `Total: ${request.totalAmount}`,
        "",
        "Itens:",
        ...items.map(
          item =>
            `- ${item.description} | ${item.categoryName} | ${item.expenseDate} | ${item.amount}`
        ),
      ];
      const pdf = buildSimplePdf(lines);
      return { name: `reembolso-${request.id}.pdf`, dataBase64: pdf.toString("base64") };
    }),
  downloadReceipt: protectedProcedure
    .input(tenantInput.extend({ attachmentId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId);
      const [attachment] = await db
        .select()
        .from(expenseAttachments)
        .where(
          and(
            eq(expenseAttachments.id, input.attachmentId),
            eq(expenseAttachments.tenantId, input.tenantId)
          )
        )
        .limit(1);
      if (!attachment) throw new TRPCError({ code: "NOT_FOUND" });
      const [request] = await db
        .select()
        .from(reimbursements)
        .where(
          and(
            eq(reimbursements.id, attachment.reimbursementId),
            eq(reimbursements.tenantId, input.tenantId)
          )
        )
        .limit(1);
      if (!request) throw new TRPCError({ code: "NOT_FOUND" });
      const financeAccess = request.paymentMembershipId === member.id;
      if (
        request.membershipId !== member.id &&
        request.currentApproverMembershipId !== member.id &&
        member.role !== "tenant_admin" &&
        !financeAccess
      )
        throw new TRPCError({ code: "FORBIDDEN" });
      const storedBytes = await storageRead(attachment.objectKey);
      if (!storedBytes.length)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Não foi possível localizar o comprovante.",
        });
      if (storedBytes.length > 5 * 1024 * 1024 + 32)
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: "O comprovante excede o tamanho permitido.",
        });
      const bytes = decryptReceipt(storedBytes);
      if (bytes.length > 5 * 1024 * 1024)
        throw new TRPCError({ code: "PAYLOAD_TOO_LARGE" });
      return {
        name: attachment.originalName,
        contentType: attachment.contentType,
        dataBase64: bytes.toString("base64"),
      };
    }),
});
