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
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";
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
  tenantHolidays,
  tenantSsoConnections,
  tenants,
  tenantSubscriptions,
  users,
  workEntries,
  workPeriods,
  workSettings,
  type User,
} from "../../drizzle/schema";
import { plans, normalizePlan, planIds } from "../../shared/plans";
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
  isPlatformAdmin,
  normalizeEmail,
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

export const tenantsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const user = requireActor(ctx.user);
    const db = await database();
    const rows = await db
      .select({
        id: memberships.id,
        tenantId: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        customDomain: tenants.customDomain,
        role: memberships.role,
        departmentId: memberships.departmentId,
        joinedAt: memberships.joinedAt,
      })
      .from(memberships)
      .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
      .where(
        and(
          eq(memberships.active, 1),
          or(
            eq(memberships.userId, user.id),
            user.email
              ? and(
                  eq(memberships.email, user.email),
                  isNull(memberships.userId)
                )
              : eq(memberships.userId, user.id)
          )
        )
      );
    const claimed = [] as typeof rows;
    for (const row of rows) {
      if (!row.joinedAt && user.email) {
        await db
          .update(memberships)
          .set({
            userId: user.id,
            joinedAt: new Date(),
            name: user.name || undefined,
          })
          .where(and(eq(memberships.id, row.id), isNull(memberships.userId)));
      }
      claimed.push(row);
    }
    return claimed;
  }),
  create: protectedProcedure
    .input(
      z.object({
        name: textField(160),
        slug: z
          .string()
          .trim()
          .min(3)
          .max(80)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      if (!user.email)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Sua conta precisa ter um e-mail para criar uma empresa.",
        });
      const db = await database();
      const [tenant] = await db
        .insert(tenants)
        .values({ name: input.name, slug: input.slug })
        .$returningId();
      const [member] = await db
        .insert(memberships)
        .values({
          tenantId: tenant.id,
          userId: user.id,
          email: user.email,
          name: user.name || input.name,
          role: "tenant_admin",
          joinedAt: new Date(),
        })
        .$returningId();
      await db.insert(workSettings).values({
        tenantId: tenant.id,
        dailyHours: "8.00",
        toleranceMinutes: 10,
        shiftStart: "09:00",
        markTypes: ["Entrada", "Saída", "Intervalo"],
        nonWorkingMarkTypes: ["Intervalo"],
        customFields: ["Projeto", "Centro de Custo"],
        locations: ["Escritório Central", "Home Office"],
      });
      await db.insert(expenseCategories).values([
        { tenantId: tenant.id, name: "Alimentação", limitAmount: "250.00" },
        { tenantId: tenant.id, name: "Transporte", limitAmount: "500.00" },
        { tenantId: tenant.id, name: "Hospedagem", limitAmount: "1200.00" },
      ]);
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await db.insert(tenantSubscriptions).values({
        tenantId: tenant.id,
        plan: "starter",
        status: "trialing",
        seatLimit: plans.starter.seatLimit,
        trialEndsAt,
        currentPeriodEnd: trialEndsAt,
      });
      await audit(db, tenant.id, member.id, "tenant", tenant.id, "created");
      return { tenantId: tenant.id, membershipId: member.id };
    }),
  platformOverview: protectedProcedure.query(async ({ ctx }) => {
    const user = requireActor(ctx.user);
    if (!isPlatformAdmin(user))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Apenas o administrador da plataforma pode acessar.",
      });
    const db = await database();
    const list = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        customDomain: tenants.customDomain,
        timezone: tenants.timezone,
        currency: tenants.currency,
        createdAt: tenants.createdAt,
        plan: tenantSubscriptions.plan,
        status: tenantSubscriptions.status,
        seatLimit: tenantSubscriptions.seatLimit,
        trialEndsAt: tenantSubscriptions.trialEndsAt,
        currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
      })
      .from(tenants)
      .leftJoin(
        tenantSubscriptions,
        eq(tenantSubscriptions.tenantId, tenants.id)
      )
      .orderBy(desc(tenants.createdAt));
    const rows = await Promise.all(
      list.map(async tenant => {
        const [[members], [entries], [requests]] = await Promise.all([
          db
            .select({ total: count() })
            .from(memberships)
            .where(
              and(
                eq(memberships.tenantId, tenant.id),
                eq(memberships.active, 1)
              )
            ),
          db
            .select({ total: count() })
            .from(workEntries)
            .where(eq(workEntries.tenantId, tenant.id)),
          db
            .select({ total: count() })
            .from(reimbursements)
            .where(eq(reimbursements.tenantId, tenant.id)),
        ]);
        return {
          ...tenant,
          plan: normalizePlan(tenant.plan),
          status: tenant.status ?? "trialing",
          seatLimit: tenant.seatLimit ?? plans.starter.seatLimit,
          members: members?.total ?? 0,
          workEntries: entries?.total ?? 0,
          reimbursements: requests?.total ?? 0,
        };
      })
    );
    const planCounts = planIds.reduce(
      (acc, plan) => {
        acc[plan] = rows.filter(row => row.plan === plan).length;
        return acc;
      },
      {} as Record<string, number>
    );
    return { total: rows.length, tenants: rows, planCounts };
  }),
  update: protectedProcedure
    .input(
      tenantInput.extend({
        name: textField(160),
        customDomain: optionalText(255),
        timezone: textField(80),
        currency: z.string().trim().length(3),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId, canAdmin);
      const domain =
        input.customDomain
          ?.trim()
          ?.toLowerCase()
          .replace(/^https?:\/\//, "")
          .replace(/\/+$/, "") || null;
      if (
        domain &&
        (domain.length > 253 ||
          !domain.includes(".") ||
          domain
            .split(".")
            .some(
              label =>
                label.length > 63 ||
                !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
            ))
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Domínio inválido.",
        });
      try {
        new Intl.DateTimeFormat("pt-BR", { timeZone: input.timezone });
      } catch {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Fuso horário inválido.",
        });
      }
      if (!["BRL", "USD", "EUR"].includes(input.currency.toUpperCase()))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Moeda não suportada.",
        });
      await db
        .update(tenants)
        .set({
          name: input.name,
          customDomain: domain,
          timezone: input.timezone,
          currency: input.currency.toUpperCase(),
        })
        .where(eq(tenants.id, input.tenantId));
      await audit(
        db,
        input.tenantId,
        member.id,
        "tenant",
        input.tenantId,
        "updated"
      );
      return { success: true };
    }),
  settings: protectedProcedure
    .input(tenantInput)
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId);
      const teamCondition =
        actor.role === "tenant_admin"
          ? eq(memberships.tenantId, input.tenantId)
          : actor.role === "manager"
            ? and(
                eq(memberships.tenantId, input.tenantId),
                or(
                  eq(memberships.id, actor.id),
                  eq(memberships.managerMembershipId, actor.id)
                )
              )
            : eq(memberships.id, actor.id);
      const [
        [tenant],
        [settings],
        [subscription],
        categories,
        rulesList,
        depts,
        team,
        holidaysList,
        [teamCount],
      ] = await Promise.all([
        db
          .select({
            id: tenants.id,
            name: tenants.name,
            slug: tenants.slug,
            customDomain: tenants.customDomain,
            timezone: tenants.timezone,
            currency: tenants.currency,
          })
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1),
        db
          .select()
          .from(workSettings)
          .where(eq(workSettings.tenantId, input.tenantId))
          .limit(1),
        db
          .select()
          .from(tenantSubscriptions)
          .where(eq(tenantSubscriptions.tenantId, input.tenantId))
          .limit(1),
        db
          .select()
          .from(expenseCategories)
          .where(eq(expenseCategories.tenantId, input.tenantId))
          .orderBy(asc(expenseCategories.name)),
        actor.role === "tenant_admin"
          ? db
              .select()
              .from(approvalRules)
              .where(eq(approvalRules.tenantId, input.tenantId))
              .orderBy(asc(approvalRules.priority))
          : Promise.resolve([]),
        actor.role === "tenant_admin" || actor.role === "manager"
          ? db
              .select()
              .from(departments)
              .where(eq(departments.tenantId, input.tenantId))
              .orderBy(asc(departments.name))
          : Promise.resolve([]),
        actor.role === "tenant_admin" || actor.role === "manager"
          ? db
              .select({
                id: memberships.id,
                name: memberships.name,
                email: memberships.email,
                role: memberships.role,
                departmentId: memberships.departmentId,
                managerMembershipId: memberships.managerMembershipId,
                active: memberships.active,
                joinedAt: memberships.joinedAt,
              })
              .from(memberships)
              .where(teamCondition)
              .orderBy(asc(memberships.name))
          : Promise.resolve([]),
        actor.role === "tenant_admin" || actor.role === "manager"
          ? db
              .select()
              .from(tenantHolidays)
              .where(eq(tenantHolidays.tenantId, input.tenantId))
              .orderBy(asc(tenantHolidays.holidayDate))
          : Promise.resolve([]),
        db
          .select({ total: count() })
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, input.tenantId),
              eq(memberships.active, 1),
              isNotNull(memberships.joinedAt)
            )
          ),
      ]);
      return {
        tenant,
        workSettings: settings,
        subscription: subscription ?? {
          plan: "starter",
          status: "trialing",
          seatLimit: plans.starter.seatLimit,
          trialEndsAt: null,
          currentPeriodEnd: null,
        },
        categories,
        approvalRules: rulesList,
        departments: depts,
        team,
        holidays: holidaysList,
        teamCount: teamCount?.total ?? 0,
      };
    }),
  updateWorkSettings: protectedProcedure
    .input(
      tenantInput.extend({
        dailyHours: z.number().min(1).max(24),
        toleranceMinutes: z.number().int().min(0).max(180),
        shiftStart: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
        markTypes: z.array(textField(40)).min(2).max(10),
        nonWorkingMarkTypes: z.array(textField(40)).max(10),
        customFields: z.array(textField(80)).max(20),
        locations: z.array(textField(120)).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId, canAdmin);
      if (
        input.nonWorkingMarkTypes.some(
          markType => !input.markTypes.includes(markType)
        )
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Todos os tipos que não contam como trabalho devem existir na lista de marcações.",
        });
      await db
        .insert(workSettings)
        .values({
          tenantId: input.tenantId,
          dailyHours: input.dailyHours.toFixed(2),
          toleranceMinutes: input.toleranceMinutes,
          shiftStart: input.shiftStart,
          markTypes: input.markTypes,
          nonWorkingMarkTypes: input.nonWorkingMarkTypes,
          customFields: input.customFields,
          locations: input.locations,
        })
        .onDuplicateKeyUpdate({
          set: {
            dailyHours: input.dailyHours.toFixed(2),
            toleranceMinutes: input.toleranceMinutes,
            shiftStart: input.shiftStart,
            markTypes: input.markTypes,
            nonWorkingMarkTypes: input.nonWorkingMarkTypes,
            customFields: input.customFields,
            locations: input.locations,
          },
        });
      await audit(
        db,
        input.tenantId,
        member.id,
        "work_settings",
        null,
        "updated"
      );
      return { success: true };
    }),
  addDepartment: protectedProcedure
    .input(tenantInput.extend({ name: textField(120) }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const member = await tenantAccess(db, user, input.tenantId, canAdmin);
      const [row] = await db
        .insert(departments)
        .values({ tenantId: input.tenantId, name: input.name })
        .$returningId();
      await audit(
        db,
        input.tenantId,
        member.id,
        "department",
        row.id,
        "created"
      );
      return { id: row.id };
    }),
  renameDepartment: protectedProcedure
    .input(tenantInput.extend({ departmentId: idSchema, name: textField(120) }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      const [department] = await db
        .select({ id: departments.id })
        .from(departments)
        .where(
          and(
            eq(departments.id, input.departmentId),
            eq(departments.tenantId, input.tenantId)
          )
        )
        .limit(1);
      if (!department) throw new TRPCError({ code: "NOT_FOUND" });
      await db
        .update(departments)
        .set({ name: input.name })
        .where(
          and(
            eq(departments.id, input.departmentId),
            eq(departments.tenantId, input.tenantId)
          )
        );
      await audit(
        db,
        input.tenantId,
        actor.id,
        "department",
        input.departmentId,
        "renamed"
      );
      return { success: true };
    }),
  deleteDepartment: protectedProcedure
    .input(tenantInput.extend({ departmentId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      const [department] = await db
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .where(
          and(
            eq(departments.id, input.departmentId),
            eq(departments.tenantId, input.tenantId)
          )
        )
        .limit(1);
      if (!department) throw new TRPCError({ code: "NOT_FOUND" });
      await db
        .delete(departments)
        .where(
          and(
            eq(departments.id, input.departmentId),
            eq(departments.tenantId, input.tenantId)
          )
        );
      await audit(
        db,
        input.tenantId,
        actor.id,
        "department",
        input.departmentId,
        "deleted",
        { name: department.name }
      );
      return { success: true };
    }),
  inviteMember: protectedProcedure
    .input(
      tenantInput.extend({
        name: textField(160),
        email: z.string().trim().email().max(320),
        role: z.enum(roles),
        departmentId: idSchema.nullable().optional(),
        managerMembershipId: idSchema.nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canManage);
      if (actor.role === "manager" && input.role !== "employee")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Gestores podem convidar apenas funcionários.",
        });
      if (input.role === "tenant_admin" && actor.role !== "tenant_admin")
        throw new TRPCError({ code: "FORBIDDEN" });
      const [subscription] = await db
        .select()
        .from(tenantSubscriptions)
        .where(eq(tenantSubscriptions.tenantId, input.tenantId))
        .limit(1);
      const seatLimit = subscription?.seatLimit ?? plans.starter.seatLimit;
      const [seatCount] = await db
        .select({ total: count() })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, input.tenantId),
            eq(memberships.active, 1)
          )
        );
      if ((seatCount?.total ?? 0) >= seatLimit)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `O plano atual permite ${seatLimit} pessoas ativas. Ajuste o plano antes de convidar.`,
        });
      if (input.departmentId) {
        const [department] = await db
          .select({ id: departments.id })
          .from(departments)
          .where(
            and(
              eq(departments.id, input.departmentId),
              eq(departments.tenantId, input.tenantId)
            )
          )
          .limit(1);
        if (!department)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Departamento não encontrado nesta empresa.",
          });
      }
      if (input.managerMembershipId) {
        const [manager] = await db
          .select({ id: memberships.id, role: memberships.role })
          .from(memberships)
          .where(
            and(
              eq(memberships.id, input.managerMembershipId),
              eq(memberships.tenantId, input.tenantId),
              eq(memberships.active, 1)
            )
          )
          .limit(1);
        if (!manager || !["manager", "tenant_admin"].includes(manager.role))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selecione um Gestor ou Admin ativo desta empresa.",
          });
      }
      const [id] = await db
        .insert(memberships)
        .values({
          tenantId: input.tenantId,
          name: input.name,
          email: normalizeEmail(input.email),
          role: input.role,
          departmentId: input.departmentId ?? null,
          managerMembershipId: input.managerMembershipId ?? null,
        })
        .$returningId();
      await audit(
        db,
        input.tenantId,
        actor.id,
        "membership",
        id.id,
        "invited",
        { role: input.role }
      );
      return { id: id.id };
    }),
  updateMember: protectedProcedure
    .input(
      tenantInput.extend({
        membershipId: idSchema,
        role: z.enum(roles),
        departmentId: idSchema.nullable(),
        managerMembershipId: idSchema.nullable(),
        active: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      const [target] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.id, input.membershipId),
            eq(memberships.tenantId, input.tenantId)
          )
        )
        .limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });
      if (
        input.membershipId === actor.id &&
        (!input.active || input.role !== "tenant_admin")
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Mantenha ao menos seu próprio acesso de administração.",
        });
      const [targetRole] = await db
        .select({ role: memberships.role })
        .from(memberships)
        .where(
          and(
            eq(memberships.id, input.membershipId),
            eq(memberships.tenantId, input.tenantId)
          )
        )
        .limit(1);
      const losesAdmin =
        targetRole?.role === "tenant_admin" &&
        (!input.active || input.role !== "tenant_admin");
      if (losesAdmin) {
        const [adminCount] = await db
          .select({ total: count() })
          .from(memberships)
          .where(
            and(
              eq(memberships.tenantId, input.tenantId),
              eq(memberships.role, "tenant_admin"),
              eq(memberships.active, 1)
            )
          );
        if ((adminCount?.total ?? 0) <= 1)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "A empresa precisa manter ao menos um administrador ativo.",
          });
      }
      if (input.departmentId !== null) {
        const [department] = await db
          .select({ id: departments.id })
          .from(departments)
          .where(
            and(
              eq(departments.id, input.departmentId),
              eq(departments.tenantId, input.tenantId)
            )
          )
          .limit(1);
        if (!department)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Departamento não encontrado nesta empresa.",
          });
      }
      if (input.managerMembershipId !== null) {
        if (input.managerMembershipId === input.membershipId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Uma pessoa não pode ser seu próprio gestor.",
          });
        const [manager] = await db
          .select({ id: memberships.id, role: memberships.role })
          .from(memberships)
          .where(
            and(
              eq(memberships.id, input.managerMembershipId),
              eq(memberships.tenantId, input.tenantId),
              eq(memberships.active, 1)
            )
          )
          .limit(1);
        if (!manager || !["manager", "tenant_admin"].includes(manager.role))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Selecione um Gestor ou Admin ativo desta empresa.",
          });
      }
      await db
        .update(memberships)
        .set({
          role: input.role,
          departmentId: input.departmentId,
          managerMembershipId: input.managerMembershipId,
          active: input.active ? 1 : 0,
        })
        .where(
          and(
            eq(memberships.id, input.membershipId),
            eq(memberships.tenantId, input.tenantId)
          )
        );
      await audit(
        db,
        input.tenantId,
        actor.id,
        "membership",
        input.membershipId,
        "updated",
        { role: input.role, active: input.active }
      );
      return { success: true };
    }),
  addCategory: protectedProcedure
    .input(
      tenantInput.extend({
        name: textField(120),
        limitAmount: z.number().positive().max(100000000).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      const [id] = await db
        .insert(expenseCategories)
        .values({
          tenantId: input.tenantId,
          name: input.name,
          limitAmount:
            input.limitAmount === null ? null : money(input.limitAmount),
        })
        .$returningId();
      await audit(
        db,
        input.tenantId,
        actor.id,
        "expense_category",
        id.id,
        "created"
      );
      return { id: id.id };
    }),
  setCategoryActive: protectedProcedure
    .input(tenantInput.extend({ categoryId: idSchema, active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      await db
        .update(expenseCategories)
        .set({ active: input.active ? 1 : 0 })
        .where(
          and(
            eq(expenseCategories.id, input.categoryId),
            eq(expenseCategories.tenantId, input.tenantId)
          )
        );
      await audit(
        db,
        input.tenantId,
        actor.id,
        "expense_category",
        input.categoryId,
        input.active ? "activated" : "deactivated"
      );
      return { success: true };
    }),
  addApprovalRule: protectedProcedure
    .input(
      tenantInput.extend({
        categoryId: idSchema.nullable(),
        approverLabel: textField(100),
        assignedMembershipId: idSchema.nullable(),
        minAmount: z.number().nonnegative().nullable(),
        maxAmount: z.number().positive().nullable(),
        priority: z.number().int().min(1).max(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      if (
        input.minAmount !== null &&
        input.maxAmount !== null &&
        input.minAmount > input.maxAmount
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "O valor mínimo não pode superar o valor máximo.",
        });
      if (input.categoryId) {
        const [category] = await db
          .select({ id: expenseCategories.id })
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
            message: "Categoria ativa não encontrada nesta empresa.",
          });
      }
      if (input.assignedMembershipId) {
        const [assignee] = await db
          .select({ id: memberships.id, role: memberships.role })
          .from(memberships)
          .where(
            and(
              eq(memberships.id, input.assignedMembershipId),
              eq(memberships.tenantId, input.tenantId),
              eq(memberships.active, 1)
            )
          )
          .limit(1);
        if (!assignee || assignee.role === "employee")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Selecione um Gestor, Financeiro, Administrativo ou Admin ativo desta empresa.",
          });
      }
      const [id] = await db
        .insert(approvalRules)
        .values({
          tenantId: input.tenantId,
          categoryId: input.categoryId,
          approverLabel: input.approverLabel,
          assignedMembershipId: input.assignedMembershipId,
          minAmount: input.minAmount === null ? null : money(input.minAmount),
          maxAmount: input.maxAmount === null ? null : money(input.maxAmount),
          priority: input.priority,
        })
        .$returningId();
      await audit(
        db,
        input.tenantId,
        actor.id,
        "approval_rule",
        id.id,
        "created"
      );
      return { id: id.id };
    }),
  setApprovalRuleActive: protectedProcedure
    .input(tenantInput.extend({ ruleId: idSchema, active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      await db
        .update(approvalRules)
        .set({ active: input.active ? 1 : 0 })
        .where(
          and(
            eq(approvalRules.id, input.ruleId),
            eq(approvalRules.tenantId, input.tenantId)
          )
        );
      await audit(
        db,
        input.tenantId,
        actor.id,
        "approval_rule",
        input.ruleId,
        input.active ? "activated" : "deactivated"
      );
      return { success: true };
    }),
  addHoliday: protectedProcedure
    .input(
      tenantInput.extend({
        holidayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        name: textField(160),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      const [existing] = await db
        .select({ id: tenantHolidays.id })
        .from(tenantHolidays)
        .where(
          and(
            eq(tenantHolidays.tenantId, input.tenantId),
            eq(tenantHolidays.holidayDate, input.holidayDate)
          )
        )
        .limit(1);
      if (existing)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Já existe um feriado cadastrado nesta data.",
        });
      const [id] = await db
        .insert(tenantHolidays)
        .values({
          tenantId: input.tenantId,
          holidayDate: input.holidayDate,
          name: input.name,
        })
        .$returningId();
      await audit(
        db,
        input.tenantId,
        actor.id,
        "holiday",
        id.id,
        "created"
      );
      return { id: id.id };
    }),
  deleteHoliday: protectedProcedure
    .input(tenantInput.extend({ holidayId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      const [holiday] = await db
        .select({ id: tenantHolidays.id })
        .from(tenantHolidays)
        .where(
          and(
            eq(tenantHolidays.id, input.holidayId),
            eq(tenantHolidays.tenantId, input.tenantId)
          )
        )
        .limit(1);
      if (!holiday) throw new TRPCError({ code: "NOT_FOUND" });
      await db
        .delete(tenantHolidays)
        .where(
          and(
            eq(tenantHolidays.id, holiday.id),
            eq(tenantHolidays.tenantId, input.tenantId)
          )
        );
      await audit(
        db,
        input.tenantId,
        actor.id,
        "holiday",
        holiday.id,
        "deleted"
      );
      return { success: true };
    }),
  updateSubscription: protectedProcedure
    .input(
      tenantInput.extend({
        plan: z.enum(planIds),
        status: z.enum(["trialing", "active", "past_due", "canceled"]),
        seatLimit: z.number().int().min(1).max(10000).optional(),
        trialEndsAt: z.coerce.date().nullable().optional(),
        currentPeriodEnd: z.coerce.date().nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      if (!isPlatformAdmin(user))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Apenas o administrador da plataforma pode alterar planos.",
        });
      const db = await database();
      const [tenant] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND" });
      const values = {
        plan: input.plan,
        status: input.status,
        seatLimit: input.seatLimit ?? plans[input.plan].seatLimit,
        trialEndsAt: input.trialEndsAt ?? null,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        notes: input.notes || null,
      };
      await db
        .insert(tenantSubscriptions)
        .values({ tenantId: input.tenantId, ...values })
        .onDuplicateKeyUpdate({ set: values });
      const [actor] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, input.tenantId),
            eq(memberships.userId, user.id)
          )
        )
        .limit(1);
      await audit(
        db,
        input.tenantId,
        actor?.id ?? null,
        "subscription",
        input.tenantId,
        `plan_${input.plan}_${input.status}`
      );
      return { success: true };
    }),
  auditLogs: protectedProcedure
    .input(tenantInput.extend({ limit: z.number().int().min(1).max(200).default(80) }))
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await tenantAccess(db, user, input.tenantId, canAdmin);
      return db
        .select({
          id: tenantAuditLogs.id,
          action: tenantAuditLogs.action,
          entityType: tenantAuditLogs.entityType,
          entityId: tenantAuditLogs.entityId,
          metadata: tenantAuditLogs.metadata,
          createdAt: tenantAuditLogs.createdAt,
          actorName: memberships.name,
          actorEmail: memberships.email,
        })
        .from(tenantAuditLogs)
        .leftJoin(
          memberships,
          eq(memberships.id, tenantAuditLogs.actorMembershipId)
        )
        .where(eq(tenantAuditLogs.tenantId, input.tenantId))
        .orderBy(desc(tenantAuditLogs.createdAt))
        .limit(input.limit);
    }),

  companyProfile: protectedProcedure
    .input(tenantInput)
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await tenantAccess(db, user, input.tenantId);
      const [tenant] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);
      if (!tenant) throw new TRPCError({ code: "NOT_FOUND" });
      return tenant;
    }),
  updateCompanyProfile: protectedProcedure
    .input(
      tenantInput.extend({
        legalName: z.string().trim().max(200).nullable().optional(),
        tradeName: z.string().trim().max(160).nullable().optional(),
        cnpj: z
          .string()
          .trim()
          .regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/)
          .nullable()
          .optional(),
        stateRegistration: z.string().trim().max(40).nullable().optional(),
        municipalRegistration: z.string().trim().max(40).nullable().optional(),
        cnae: z.string().trim().max(20).nullable().optional(),
        legalNature: z.string().trim().max(120).nullable().optional(),
        taxRegime: z.string().trim().max(80).nullable().optional(),
        addressStreet: z.string().trim().max(200).nullable().optional(),
        addressNumber: z.string().trim().max(30).nullable().optional(),
        addressComplement: z.string().trim().max(120).nullable().optional(),
        addressDistrict: z.string().trim().max(120).nullable().optional(),
        addressCity: z.string().trim().max(120).nullable().optional(),
        addressState: z.string().trim().length(2).nullable().optional(),
        addressPostalCode: z
          .string()
          .trim()
          .regex(/^\d{5}-?\d{3}$/)
          .nullable()
          .optional(),
        addressCountry: z.string().trim().max(60).nullable().optional(),
        corporateEmail: z.string().trim().email().max(320).nullable().optional(),
        phone: z.string().trim().max(40).nullable().optional(),
        website: z.string().trim().max(255).nullable().optional(),
        adminContactName: z.string().trim().max(160).nullable().optional(),
        adminContactEmail: z.string().trim().email().max(320).nullable().optional(),
        adminContactPhone: z.string().trim().max(40).nullable().optional(),
        locale: z.string().trim().max(12).nullable().optional(),
        dateFormat: z.string().trim().max(20).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      const values: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input)) {
        if (key === "tenantId") continue;
        if (value !== undefined) values[key] = value === "" ? null : value;
      }
      await db.update(tenants).set(values).where(eq(tenants.id, input.tenantId));
      await audit(db, input.tenantId, actor.id, "tenant", input.tenantId, "company_profile_updated");
      return { success: true };
    }),
  ssoConfig: protectedProcedure
    .input(tenantInput)
    .query(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await tenantAccess(db, user, input.tenantId, canAdmin);
      const [config] = await db
        .select()
        .from(tenantSsoConnections)
        .where(
          and(
            eq(tenantSsoConnections.tenantId, input.tenantId),
            eq(tenantSsoConnections.provider, "microsoft")
          )
        )
        .limit(1);
      return config ?? null;
    }),
  saveSsoConfig: protectedProcedure
    .input(
      tenantInput.extend({
        microsoftTenantId: z.string().trim().min(1).max(120),
        clientId: z.string().trim().min(1).max(200),
        clientSecret: z.string().trim().max(500).optional(),
        redirectUri: z.string().trim().url().max(500),
        allowedDomains: z.array(z.string().trim().max(255)).default([]),
        loginMode: z.literal("optional").default("optional"),
        jitProvisioning: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      const actor = await tenantAccess(db, user, input.tenantId, canAdmin);
      const values = {
        tenantId: input.tenantId,
        provider: "microsoft" as const,
        microsoftTenantId: input.microsoftTenantId,
        clientId: input.clientId,
        clientSecretEncrypted: input.clientSecret
          ? Buffer.from(input.clientSecret).toString("base64")
          : null,
        redirectUri: input.redirectUri,
        allowedDomains: input.allowedDomains,
        loginMode: input.loginMode,
        jitProvisioning: input.jitProvisioning ? 1 : 0,
        enabled: 1,
      };
      await db
        .insert(tenantSsoConnections)
        .values(values)
        .onDuplicateKeyUpdate({ set: values });
      await audit(db, input.tenantId, actor.id, "sso", input.tenantId, "microsoft_config_saved");
      return { success: true };
    }),
  testSsoConnection: protectedProcedure
    .input(tenantInput)
    .mutation(async ({ ctx, input }) => {
      const user = requireActor(ctx.user);
      const db = await database();
      await tenantAccess(db, user, input.tenantId, canAdmin);
      const [config] = await db
        .select()
        .from(tenantSsoConnections)
        .where(
          and(
            eq(tenantSsoConnections.tenantId, input.tenantId),
            eq(tenantSsoConnections.provider, "microsoft")
          )
        )
        .limit(1);
      if (!config) throw new TRPCError({ code: "NOT_FOUND" });
      const issuer = `https://login.microsoftonline.com/${config.microsoftTenantId}/v2.0`;
      const response = await fetch(`${issuer}/.well-known/openid-configuration`);
      if (!response.ok)
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "Não foi possível consultar a configuração OIDC da Microsoft.",
        });
      const metadata = await response.json();
      return {
        success: true,
        issuer: metadata.issuer,
        authorizationEndpoint: metadata.authorization_endpoint,
        tokenEndpoint: metadata.token_endpoint,
        jwksUri: metadata.jwks_uri,
      };
    }),

});
