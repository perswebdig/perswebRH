import { describe, expect, it, beforeAll } from "vitest";
import { appRouter } from "./routers";
import { getDb } from "./db";
import { memberships, tenants, users } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

describe("tenant isolation", () => {
  let tenantA = 0;
  let tenantB = 0;
  let userAId = 0;
  let userBId = 0;
  let membershipA = 0;
  let membershipB = 0;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("database unavailable");

    const [ua] = await db
      .insert(users)
      .values({ openId: `iso_a_${Date.now()}`, name: "User A", role: "user" })
      .$returningId();
    const [ub] = await db
      .insert(users)
      .values({ openId: `iso_b_${Date.now()}`, name: "User B", role: "user" })
      .$returningId();
    userAId = ua.id;
    userBId = ub.id;

    const [ta] = await db
      .insert(tenants)
      .values({ name: "Tenant A", slug: `tenant-a-${Date.now()}` })
      .$returningId();
    const [tb] = await db
      .insert(tenants)
      .values({ name: "Tenant B", slug: `tenant-b-${Date.now()}` })
      .$returningId();
    tenantA = ta.id;
    tenantB = tb.id;

    const [ma] = await db
      .insert(memberships)
      .values({
        tenantId: tenantA,
        userId: userAId,
        email: "a@test.local",
        name: "User A",
        role: "employee",
        active: 1,
        joinedAt: new Date(),
      })
      .$returningId();
    const [mb] = await db
      .insert(memberships)
      .values({
        tenantId: tenantB,
        userId: userBId,
        email: "b@test.local",
        name: "User B",
        role: "employee",
        active: 1,
        joinedAt: new Date(),
      })
      .$returningId();
    membershipA = ma.id;
    membershipB = mb.id;
  });

  function ctx(userId: number, openId: string, membershipId: number, tenantId: number): TrpcContext {
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

  it("blocks tenant B settings for user A", async () => {
    const caller = appRouter.createCaller(ctx(userAId, `iso_a`, membershipA, tenantA));
    await expect(caller.tenants.settings({ tenantId: tenantB })).rejects.toThrow();
  });

  it("blocks tenant B reimbursements for user A", async () => {
    const caller = appRouter.createCaller(ctx(userAId, `iso_a`, membershipA, tenantA));
    await expect(caller.reimbursements.list({ tenantId: tenantB })).rejects.toThrow();
  });

  it("blocks tenant B attendance for user A", async () => {
    const caller = appRouter.createCaller(ctx(userAId, `iso_a`, membershipA, tenantA));
    await expect(
      caller.attendance.myWeek({ tenantId: tenantB, date: "2026-10-26" })
    ).rejects.toThrow();
  });
});
