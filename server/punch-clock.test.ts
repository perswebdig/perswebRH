import { describe, expect, it, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { appRouter } from "./routers";
import { getDb } from "./db";
import {
  memberships,
  punchEvents,
  punchRequests,
  tenants,
  users,
  workEntries,
  workSettings,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const token = () => `tok-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const day = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA");
};

describe("punch clock (real-time)", () => {
  let tenantId = 0;
  let managerUserId = 0;
  let managerOpenId = "";
  let managerId = 0;
  let employeeUserId = 0;
  let employeeOpenId = "";
  let employeeId = 0;
  let otherTenantId = 0;
  let otherUserId = 0;
  let otherOpenId = "";
  let otherMemberId = 0;
  let pendingFromTest6 = 0;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("database unavailable");
    const suffix = Date.now();

    const [tu] = await db
      .insert(users)
      .values({ openId: `punch_mgr_${suffix}`, name: "Gestor", role: "user" })
      .$returningId();
    managerUserId = tu.id;
    managerOpenId = tu.openId;
    const [eu] = await db
      .insert(users)
      .values({ openId: `punch_emp_${suffix}`, name: "Colaborador", role: "user" })
      .$returningId();
    employeeUserId = eu.id;
    employeeOpenId = eu.openId;
    const [ou] = await db
      .insert(users)
      .values({ openId: `punch_out_${suffix}`, name: "Outro", role: "user" })
      .$returningId();
    otherUserId = ou.id;
    otherOpenId = ou.openId;

    const [t] = await db
      .insert(tenants)
      .values({ name: "Punch Co", slug: `punch-${suffix}` })
      .$returningId();
    tenantId = t.id;
    const [ot] = await db
      .insert(tenants)
      .values({ name: "Outra Co", slug: `punch-out-${suffix}` })
      .$returningId();
    otherTenantId = ot.id;

    const [m] = await db
      .insert(memberships)
      .values({
        tenantId,
        userId: managerUserId,
        email: "mgr@punch.local",
        name: "Gestor",
        role: "tenant_admin",
        active: 1,
        joinedAt: new Date(),
      })
      .$returningId();
    managerId = m.id;
    const [e] = await db
      .insert(memberships)
      .values({
        tenantId,
        userId: employeeUserId,
        email: "emp@punch.local",
        name: "Colaborador",
        role: "employee",
        managerMembershipId: managerId,
        active: 1,
        joinedAt: new Date(),
      })
      .$returningId();
    employeeId = e.id;
    const [om] = await db
      .insert(memberships)
      .values({
        tenantId: otherTenantId,
        userId: otherUserId,
        email: "out@punch.local",
        name: "Outro",
        role: "employee",
        active: 1,
        joinedAt: new Date(),
      })
      .$returningId();
    otherMemberId = om.id;

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
  });

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
  const employee = () => appRouter.createCaller(ctx(employeeUserId, employeeOpenId));
  const manager = () => appRouter.createCaller(ctx(managerUserId, managerOpenId));
  const outsider = () => appRouter.createCaller(ctx(otherUserId, otherOpenId));

  it("1. entry in real time stores the server instant without manual start/end", async () => {
    const before = Date.now();
    const result = await employee().punch.punch({
      tenantId,
      eventType: "ENTRY",
      clientToken: token(),
    });
    const after = Date.now();
    const occurred = new Date(result.occurredAt).getTime();
    expect(occurred).toBeGreaterThanOrEqual(before - 1000);
    expect(occurred).toBeLessThanOrEqual(after + 1000);
    expect(result.workDate).toBe(day(0));
    const state = await employee().punch.punchState({ tenantId });
    expect(state.state).toBe("working");
    expect(state.actions).toContain("EXIT");
    expect(state.actions).not.toContain("ENTRY");
  });

  it("2. exit closes the period, computes duration and materializes work entry", async () => {
    await new Promise(resolve => setTimeout(resolve, 1100));
    const result = await employee().punch.punch({
      tenantId,
      eventType: "EXIT",
      clientToken: token(),
    });
    expect(result.duplicate).toBe(false);
    const entries = await employee().attendance.myWeek({
      tenantId,
      date: day(0),
    });
    const punchEntry = entries.entries.find(
      entry => entry.source === "punch" && entry.workDate === day(0)
    );
    expect(punchEntry).toBeTruthy();
    const minutes =
      (new Date(punchEntry!.endedAt).getTime() -
        new Date(punchEntry!.startedAt).getTime()) /
      60000;
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThan(5);
    const state = await employee().punch.punchState({ tenantId });
    expect(state.state).toBe("off");
    expect(state.workedMinutes).toBeGreaterThanOrEqual(0);
  });

  it("3. rejects invalid sequences: exit without entry, duplicate entry, break without pair", async () => {
    // exit without open entry
    await expect(
      employee().punch.punch({ tenantId, eventType: "EXIT", clientToken: token() })
    ).rejects.toThrow();
    // duplicate entry: entry -> entry
    await employee().punch.punch({ tenantId, eventType: "ENTRY", clientToken: token() });
    await expect(
      employee().punch.punch({ tenantId, eventType: "ENTRY", clientToken: token() })
    ).rejects.toThrow();
    // break end without break start
    await expect(
      employee().punch.punch({ tenantId, eventType: "BREAK_END", clientToken: token() })
    ).rejects.toThrow();
    // break start then entry not allowed
    await employee().punch.punch({ tenantId, eventType: "BREAK_START", clientToken: token() });
    await expect(
      employee().punch.punch({ tenantId, eventType: "ENTRY", clientToken: token() })
    ).rejects.toThrow();
    await employee().punch.punch({ tenantId, eventType: "BREAK_END", clientToken: token() });
    await employee().punch.punch({ tenantId, eventType: "EXIT", clientToken: token() });
  });

  it("4. same client token is idempotent: no duplicated punches on retry", async () => {
    const sameToken = token();
    const first = await employee().punch.punch({
      tenantId,
      eventType: "ENTRY",
      clientToken: sameToken,
    });
    const second = await employee().punch.punch({
      tenantId,
      eventType: "ENTRY",
      clientToken: sameToken,
    });
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    await employee().punch.punch({ tenantId, eventType: "EXIT", clientToken: token() });
  });

  it("5. concurrent punches from two devices: only one wins per state", async () => {
    const [first, second] = await Promise.allSettled([
      employee().punch.punch({ tenantId, eventType: "ENTRY", clientToken: token() }),
      employee().punch.punch({ tenantId, eventType: "ENTRY", clientToken: token() }),
    ]);
    const fulfilled = [first, second].filter(r => r.status === "fulfilled");
    expect(fulfilled.length).toBe(1);
    await employee().punch.punch({ tenantId, eventType: "EXIT", clientToken: token() });
  });

  it("6. retroactive request for a past day stays pending and does not touch official totals", async () => {
    const yesterday = day(-1);
    const before = await employee().punch.punchState({ tenantId });
    const request = await employee().punch.createPunchRequest({
      tenantId,
      workDate: yesterday,
      events: [
        { eventType: "ENTRY", time: "08:00" },
        { eventType: "EXIT", time: "12:00" },
      ],
      reason: "Esqueci de bater o ponto ontem pela manhã.",
    });
    expect(request.id).toBeGreaterThan(0);
    const mine = await employee().punch.listPunchRequests({ tenantId, scope: "mine" });
    const created = mine.find(row => row.id === request.id);
    expect(created?.status).toBe("pending");
    const after = await employee().punch.punchState({ tenantId });
    expect(after.workedMinutes).toBe(before.workedMinutes);
    pendingFromTest6 = request.id;
    const db = (await getDb())!;
    const events = await db.select().from(punchEvents).where(eq(punchEvents.tenantId, tenantId));
    expect(events.every(event => event.source !== "retroactive_approval")).toBe(true);
  });

  it("7. future dates and future times are rejected", async () => {
    await expect(
      employee().punch.createPunchRequest({
        tenantId,
        workDate: day(1),
        events: [{ eventType: "ENTRY", time: "09:00" }],
        reason: "Planejamento",
      })
    ).rejects.toThrow(/futura/i);
    await expect(
      employee().punch.createPunchRequest({
        tenantId,
        workDate: day(0),
        events: [{ eventType: "ENTRY", time: "23:59" }],
        reason: "Tentativa de horário futuro",
      })
    ).rejects.toThrow();
    // admin manual entry with future end time
    await expect(
      manager().attendance.addEntry({
        tenantId,
        workDate: day(0),
        startedAt: new Date(Date.now() + 3600_000).toISOString(),
        endedAt: new Date(Date.now() + 7200_000).toISOString(),
        activity: "Correção",
        markType: "Entrada",
        locationMode: "manual",
        locationName: "Escritório",
      })
    ).rejects.toThrow();
  });

  it("8. approver flow: requester cannot approve own, rejection needs reason, approval creates audited official events", async () => {
    // clear the pending request left by test 6 (duplicate-pending guard)
    if (pendingFromTest6)
      await employee().punch.cancelPunchRequest({ tenantId, requestId: pendingFromTest6 });
    const yesterday = day(-1);
    // manager creates own request: another admin does not exist -> manager cannot self-approve
    const mgrRequest = await manager().punch.createPunchRequest({
      tenantId,
      workDate: yesterday,
      events: [
        { eventType: "ENTRY", time: "13:00" },
        { eventType: "EXIT", time: "18:00" },
      ],
      reason: "Ajuste do gestor para teste de auto-aprovação",
    });
    await expect(
      manager().punch.decidePunchRequest({
        tenantId,
        requestId: mgrRequest.id,
        decision: "approved",
      })
    ).rejects.toThrow(/própria/i);
    await manager().punch.cancelPunchRequest({ tenantId, requestId: mgrRequest.id });

    const request = await employee().punch.createPunchRequest({
      tenantId,
      workDate: yesterday,
      events: [
        { eventType: "ENTRY", time: "08:00" },
        { eventType: "EXIT", time: "12:00" },
      ],
      reason: "Ponto não batido ontem",
    });
    // employee cannot approve
    await expect(
      employee().punch.decidePunchRequest({
        tenantId,
        requestId: request.id,
        decision: "approved",
      })
    ).rejects.toThrow();
    // rejection requires reason
    await expect(
      manager().punch.decidePunchRequest({
        tenantId,
        requestId: request.id,
        decision: "rejected",
      })
    ).rejects.toThrow(/motivo/i);
    // approve now
    const approval = await manager().punch.decidePunchRequest({
      tenantId,
      requestId: request.id,
      decision: "approved",
      note: "Conferido com a equipe.",
    });
    expect(approval.createdEventIds.length).toBe(2);
    const db = (await getDb())!;
    const events = await db
      .select()
      .from(punchEvents)
      .where(eq(punchEvents.requestId, request.id));
    expect(events.length).toBe(2);
    expect(events.every(event => event.source === "retroactive_approval")).toBe(true);
    expect(events.every(event => event.workDate === yesterday)).toBe(true);
    const materialized = await db
      .select()
      .from(workEntries)
      .where(
        and(
          eq(workEntries.tenantId, tenantId),
          eq(workEntries.source, "retroactive")
        )
      );
    expect(materialized.length).toBe(1);
    // entry at 08:00, exit at 12:00 in tenant tz -> 4h window
    const minutes =
      (new Date(materialized[0].endedAt).getTime() -
        new Date(materialized[0].startedAt).getTime()) /
      60000;
    expect(minutes).toBe(240);
    // double decision is blocked
    await expect(
      manager().punch.decidePunchRequest({
        tenantId,
        requestId: request.id,
        decision: "approved",
      })
    ).rejects.toThrow(/analisada/i);
  });

  it("9. tenant isolation: outsider cannot punch, see state, list or approve", async () => {
    await expect(
      outsider().punch.punchState({ tenantId })
    ).rejects.toThrow();
    await expect(
      outsider().punch.punch({ tenantId, eventType: "ENTRY", clientToken: token() })
    ).rejects.toThrow();
    await expect(
      outsider().punch.listPunchRequests({ tenantId, scope: "approval" })
    ).rejects.toThrow();
    await expect(
      outsider().punch.decidePunchRequest({
        tenantId,
        requestId: 1,
        decision: "approved",
      })
    ).rejects.toThrow();
  });

  it("10. punch-day totals and open period flag behave per pairing", async () => {
    const state = await employee().punch.punchState({ tenantId });
    const dayData = await employee().punch.punchDay({
      tenantId,
      date: day(0),
    });
    expect(dayData.events.length).toBeGreaterThan(0);
    expect(dayData.hasOpenPeriod).toBe(state.state !== "off");
    // break pair does not add worked minutes
    await employee().punch.punch({ tenantId, eventType: "ENTRY", clientToken: token() });
    await employee().punch.punch({ tenantId, eventType: "BREAK_START", clientToken: token() });
    const onBreak = await employee().punch.punchState({ tenantId });
    expect(onBreak.state).toBe("on_break");
    await new Promise(resolve => setTimeout(resolve, 1100));
    await employee().punch.punch({ tenantId, eventType: "BREAK_END", clientToken: token() });
    const backToWork = await employee().punch.punchState({ tenantId });
    expect(backToWork.state).toBe("working");
    const db = (await getDb())!;
    const withBreak = await db
      .select()
      .from(workEntries)
      .where(
        and(
          eq(workEntries.tenantId, tenantId),
          eq(workEntries.membershipId, employeeId),
          eq(workEntries.workDate, day(0)),
          eq(workEntries.countsAsWork, false)
        )
      );
    // the break pair from this test materializes as a non-work entry
    expect(withBreak.length).toBe(1);
    await employee().punch.punch({ tenantId, eventType: "EXIT", clientToken: token() });
  });
});
