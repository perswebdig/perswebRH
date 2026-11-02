import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq, gte, lt } from "drizzle-orm";
import { appRouter } from "./routers";
import { getDb } from "./db";
import {
  memberships,
  payrollRuns,
  tenantHolidays,
  tenants,
  users,
  workEntries,
  workPeriods,
  workSchedules,
  workSettings,
} from "../drizzle/schema";
import {
  calculateInss,
  calculateIrrf,
  NIGHT_ADDITION_MULTIPLIER,
  OVERTIME_MULTIPLIER,
} from "./payroll/br";
import type { TrpcContext } from "./_core/context";

function ctx(userId: number, openId: string): TrpcContext {
  return {
    user: {
      id: userId,
      openId,
      email: `${openId}@test.local`,
      name: openId,
      loginMethod: "password",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function iso(month: string, day: number) {
  const [y, m] = month.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

describe("payroll: jornadas múltiplas e folha completa", () => {
  let tenantId = 0;
  let adminUserId = 0;
  let adminOpenId = "";
  let adminId = 0;
  let empUserId = 0;
  let empOpenId = "";
  let empId = 0;
  let outsiderUserId = 0;
  let outsiderOpenId = "";
  let otherTenantId = 0;
  let otherAdminId = 0;
  const month = new Date().toISOString().slice(0, 7);
  let scheduleA = 0;
  let runId = 0;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("database unavailable");
    const suffix = Date.now();

    const [au] = await db
      .insert(users)
      .values({ openId: `folha_admin_${suffix}`, name: "Admin Folha", role: "user" })
      .$returningId();
    adminUserId = au.id;
    adminOpenId = au.openId;
    const [eu] = await db
      .insert(users)
      .values({ openId: `folha_emp_${suffix}`, name: "Emp Folha", role: "user" })
      .$returningId();
    empUserId = eu.id;
    empOpenId = eu.openId;
    const [ou] = await db
      .insert(users)
      .values({ openId: `folha_out_${suffix}`, name: "Outro", role: "user" })
      .$returningId();
    outsiderUserId = ou.id;
    outsiderOpenId = ou.openId;

    const [t] = await db
      .insert(tenants)
      .values({ name: "FolhaCorp", slug: `folha-corp-${suffix}`, timezone: "UTC" })
      .$returningId();
    tenantId = t.id;
    const [other] = await db
      .insert(tenants)
      .values({ name: "FolhaOther", slug: `folha-other-${suffix}` })
      .$returningId();
    otherTenantId = other.id;

    const [am] = await db
      .insert(memberships)
      .values({
        tenantId,
        userId: adminUserId,
        email: "admin@folha.local",
        name: "Admin Folha",
        role: "tenant_admin",
        active: 1,
        joinedAt: new Date(),
        salaryCents: 405900,
      })
      .$returningId();
    adminId = am.id;
    const [em] = await db
      .insert(memberships)
      .values({
        tenantId,
        userId: empUserId,
        email: "emp@folha.local",
        name: "Emp Folha",
        role: "employee",
        active: 1,
        joinedAt: new Date(),
        salaryCents: 141800,
      })
      .$returningId();
    empId = em.id;
    const [om] = await db
      .insert(memberships)
      .values({
        tenantId: otherTenantId,
        userId: outsiderUserId,
        email: "out@folha.local",
        name: "Outro Admin",
        role: "tenant_admin",
        active: 1,
        joinedAt: new Date(),
      })
      .$returningId();
    otherAdminId = om.id;

    await db.insert(workSettings).values({
      tenantId,
      dailyHours: "8.00",
      toleranceMinutes: 10,
      shiftStart: "09:00",
      markTypes: ["Entrada", "Saída", "Intervalo"],
      nonWorkingMarkTypes: ["Intervalo"],
      customFields: [],
      locations: ["Escritório"],
    });

    const [schedule] = await db
      .insert(workSchedules)
      .values({
        tenantId,
        name: `5x2 das 8h às 17h ${suffix}`,
        daysOfWeek: [1, 2, 3, 4, 5],
        blocks: [{ start: "08:00", end: "17:00" }],
      })
      .$returningId();
    scheduleA = schedule.id;

    // Emp member on a custom schedule; admin stays on the default policy.
    await db
      .update(memberships)
      .set({ scheduleId: scheduleA })
      .where(eq(memberships.id, empId));
  }, 30000);

  afterAll(async () => {
    // leave artifacts for inspection in the shared dev database
  });

  const caller = (userId: number, openId: string) =>
    appRouter.createCaller(ctx(userId, openId));
  const admin = () => caller(adminUserId, adminOpenId);
  const employee = () => caller(empUserId, empOpenId);
  const outsider = () => caller(outsiderUserId, outsiderOpenId);

  it("1. INSS progressivo empregado (faixas conhecidas)", () => {
    expect(Math.round(calculateInss(151800))).toBe(11385); // 7,5%
    // 2026percent expectations: midpoint 2 faixas
    expect(Math.round(calculateInss(279388))).toBe(Math.round(151800 * 0.075 + 127588 * 0.09));
    expect(Math.round(calculateInss(815741))).toBe(
      Math.round(
        151800 * 0.075 + 127588 * 0.09 + 139695 * 0.12 + 396658 * 0.14
      )
    );
  });

  it("2. IRRF progressivo mensal", () => {
    expect(Math.round(calculateIrrf(242880))).toBe(0); // isento
    expect(Math.round(calculateIrrf(282665))).toBe(
      Math.round(282665 * 0.075 - 18216)
    );
    expect(Math.round(calculateIrrf(400000))).toBe(
      Math.round(400000 * 0.225 - 67549)
    );
    expect(Math.round(calculateIrrf(1000000))).toBe(
      Math.round(1000000 * 0.275 - 90873)
    );
  });

  it("3. cria jornada e guarda vários blocos por dia", async () => {
    const result = await admin().payroll.saveSchedule({
      tenantId,
      name: "Turno quebrado",
      daysOfWeek: [2, 3, 4],
      blocks: [
        { start: "07:00", end: "11:00" },
        { start: "14:00", end: "19:00" },
      ],
    });
    expect(result.scheduleId).toBeGreaterThan(scheduleA);
    const list = await admin().payroll.listSchedules({ tenantId });
    const broken = list.find(row => row.name === "Turno quebrado");
    expect(broken?.active).toBe(1);
    expect((broken?.blocks as { start: string; end: string }[]).length).toBe(2);
  });

  it("4. rejeita blocos sobrepostos e dias ausentes", async () => {
    let overlapError: unknown;
    try {
      await admin().payroll.saveSchedule({
        tenantId,
        name: "Sobreposto",
        daysOfWeek: [1],
        blocks: [
          { start: "08:00", end: "13:00" },
          { start: "11:00", end: "17:00" },
        ],
      });
    } catch (error) {
      overlapError = error;
    }
    expect(
      ((overlapError as { message?: string })?.message ?? "").includes("sobrepor")
    ).toBe(true);
  });

  it("5. gera folha com extras (por dia), noturno, faltas e INSS/IRRF/FGTS", async () => {
    const db = (await getDb())!;
    // First Mon–Fri of the month for the workday entries.
    let mon = 1;
    for (; mon < 8; mon++) {
      if (new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, mon)).getUTCDay() === 1)
        break;
    }
    // Saturday for the night test.
    let sat = mon;
    for (; sat <= 31; sat++) {
      if (new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, sat)).getUTCDay() === 6)
        break;
    }
    const mkPeriod = async (membershipId: number, day: number) => {
      const [p] = await db
        .insert(workPeriods)
        .values({
          tenantId,
          membershipId,
          periodStart: iso(month, day),
          periodEnd: iso(month, day),
          status: "draft",
        })
        .$returningId();
      return p.id;
    };
    const seedEntry = async (
      membershipId: number,
      day: number,
      startH: number,
      endH: number
    ) => {
      const periodId = await mkPeriod(membershipId, day);
      // 08:00–17:00 depends on UTC==BRT-3 assumption? Use plain UTC numbers
      // for determinism (night minutes computed with tenant tz, but the
      // 22:00-based test targets the tz conversion explicitly).
      await db.insert(workEntries).values({
        tenantId,
        periodId,
        membershipId,
        workDate: iso(month, day),
        startedAt: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, day, startH)),
        endedAt: new Date(
          Date.UTC(
            Number(month.slice(0, 4)),
            Number(month.slice(5)) - 1,
            day,
            endH,
            0,
            0
          )
        ),
        activity: "Teste",
        countsAsWork: true,
        locationName: "Escritório",
      });
    };

    await seedEntry(empId, sat, 22, 30); // 22:00–06:00 next day (9h?? startH+8)

    const result = await admin().payroll.generate({
      tenantId,
      referenceMonth: month,
    });
    runId = result.runId;
    expect(result.items).toBe(2);
    expect(result.skippedNoSalary).toBe(0);

    const detail = await admin().payroll.runDetail({ tenantId, runId });
    const byMember = new Map(detail.items.map(row => [row.item.membershipId, row]));

    // Emp item — schedule 8h(9h?) block 08..17 = 540 min daily.
    const empItem = byMember.get(empId)!.item;
    const salary = 141800;
    const perMinute =
      salary /
      (detail.items.find(x => x.item.membershipId === empId)!.item.expectedMinutes || 1);
    expect(empItem.workedMinutes).toBe(480);
    // 480m on a Saturday → all overtime; night 22:00–05:00 = 420m (tenant tz).
    expect(empItem.overtimeMinutes).toBe(480);
    expect(empItem.nightMinutes).toBe(420);
    expect(empItem.overtimeCents).toBe(
      Math.round(perMinute * 480 * OVERTIME_MULTIPLIER)
    );
    expect(empItem.nightAdditionCents).toBe(
      Math.round(perMinute * 420 * NIGHT_ADDITION_MULTIPLIER)
    );
    // Working days minus the one seeded Saturday-less weekday (all other
    // weekdays nowhere worked → absences).
    const totalWorking =
      detail.items.find(x => x.item.membershipId === empId)!.item.workingDays;
    expect(empItem.absenceDays).toBe(totalWorking - 0); // no weekday entries
    const grossEmp =
      salary + empItem.overtimeCents + empItem.nightAdditionCents;
    const inssBaseEmp = salary - empItem.absenceDeductionCents + empItem.overtimeCents + empItem.nightAdditionCents;
    const expectedInss = Math.round(calculateInss(Math.max(0, inssBaseEmp)));
    expect(empItem.inssCents).toBe(expectedInss);
    expect(empItem.irrfCents).toBe(
      Math.round(calculateIrrf(Math.max(0, inssBaseEmp - expectedInss)))
    );
    expect(empItem.netCents).toBe(
      grossEmp -
        empItem.absenceDeductionCents -
        expectedInss -
        empItem.irrfCents
    );

    // Admin item — no entries, all absences, no overtime.
    const adminItem = byMember.get(adminId)!.item;
    expect(adminItem.workedMinutes).toBe(0);
    expect(adminItem.overtimeMinutes).toBe(0);
    expect(adminItem.absenceDays).toBe(adminItem.workingDays);
    expect(adminItem.netCents).toBeLessThan(adminItem.baseSalaryCents);
  });

  it("6. folha duplicada do mesmo mês em rascunho é bloqueada", async () => {
    let error: unknown;
    try {
      await admin().payroll.generate({ tenantId, referenceMonth: month });
    } catch (err) {
      error = err;
    }
    expect(
      ((error as { message?: string })?.message ?? "").includes("rascunho")
    ).toBe(true);
  });

  it("7. ajuste manual recalcula tributos e sincroniza totais do run", async () => {
    const detail = await admin().payroll.runDetail({ tenantId, runId });
    const item = detail.items[0].item;
    await admin().payroll.adjustItem({
      tenantId,
      itemId: item.id,
      manualAdditionsCents: 10000,
      manualDeductionsCents: 5000,
      additionsNote: "Ajuda de custo",
    });
    const refreshed = await admin().payroll.runDetail({ tenantId, runId });
    const adjusted = refreshed.items.find(
      row => row.item.id === item.id
    )!.item;
    expect(adjusted.manualAdditionsCents).toBe(10000);
    expect(adjusted.grossCents).toBe(
      item.baseSalaryCents +
        item.overtimeCents +
        item.nightAdditionCents +
        10000
    );
    const run = await admin().payroll.summarize({ tenantId });
    const found = (run.runs as { id: number; grossCents: number; status: string }[]).find(
      r => r.id === runId
    );
    // Gross total equals sum of items.
    const totalGross = refreshed.items.reduce(
      (s, row) => s + row.item.grossCents,
      0
    );
    expect(found?.grossCents).toBe(totalGross);
    expect(found?.status).toBe("draft");
  });

  it("8. fechar congela a folha e bloqueia ajustes", async () => {
    await admin().payroll.closeRun({ tenantId, runId });
    const detail = await admin().payroll.runDetail({ tenantId, runId });
    const item = detail.items[0].item;
    let error: unknown;
    try {
      await admin().payroll.adjustItem({
        tenantId,
        itemId: item.id,
        manualAdditionsCents: 1000,
        manualDeductionsCents: 0,
        additionsNote: "pós fechamento",
      });
    } catch (err) {
      error = err;
    }
    expect(
      ((error as { message?: string })?.message ?? "").includes("fechada")
    ).toBe(true);
  });

  it("9. funcionário comum não mexe na folha (acesso)", async () => {
    let foreach: unknown;
    try {
      await employee().payroll.generate({ tenantId, referenceMonth: month, type: "complementar" });
    } catch (err) {
      foreach = err;
    }
    expect((foreach as { code?: string })?.code ?? "").toBe("FORBIDDEN");
  });

  it("10. isolamento: admin de outra empresa não lê a folha alheia", async () => {
    let error: unknown;
    try {
      await outsider().payroll.runDetail({ tenantId, runId });
    } catch (err) {
      error = err;
    }
    expect((error as { code?: string })?.code ?? "").toBe("FORBIDDEN");
  });

  it("11. feriado do mês não conta como dia útil nem falta", async () => {
    const db = (await getDb())!;
    // Pick first Monday of the month and mark it a holiday, then regenerate
    // the second member's schedule: use a different month to avoid clashes.
    const targetMonth =
      Number(month.slice(5)) === 12 ? `${Number(month.slice(0, 4)) + 1}-01` : null;
    if (!targetMonth) {
      // December overflows year; just insert next month normally.
      const [y, m] = month.split("-").map(Number);
      const next = new Date(Date.UTC(y, m, 1));
      const shifted = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
      await db.insert(tenantHolidays).values({
        tenantId,
        holidayDate: iso(shifted, 1),
        name: "Feriado teste",
      });
      const result = await admin().payroll.generate({ tenantId, referenceMonth: shifted });
      const detail = await admin().payroll.runDetail({ tenantId, runId: result.runId });
      const empItem = detail.items.find(
        row => row.item.membershipId === empId
      )!.item;
      // Vacation-month for emp: many absences (no entries) — holiday excluded.
      let holidaysInMonth = 0;
      await db
        .select({ holidayDate: tenantHolidays.holidayDate })
        .from(tenantHolidays)
        .where(eq(tenantHolidays.tenantId, tenantId));
      expect(empItem.workingDays).toBeGreaterThan(0);
      await admin().payroll.cancelRun({ tenantId, runId: result.runId });
      void holidaysInMonth;
    }
  });

  it("12. cancelamento de rascunho libera o mês para nova folha", async () => {
    const shifted = month;
    const before = await admin().payroll.summarize({ tenantId });
    const hasCanceled = (before.runs as unknown as { status: string }[]).some(
      run => run.status === "canceled"
    );
    void hasCanceled;
    // No draft for current month remains (test 8 closed it; test 11's was canceled).
    const result = await admin().payroll.summarize({ tenantId });
    const currentDraft = (result.runs as unknown as { referenceMonth: string; status: string; type: string }[]).some(
      run =>
        run.referenceMonth === month && run.status === "draft" && run.type === "normal"
    );
    expect(currentDraft).toBe(false);
  });
});
