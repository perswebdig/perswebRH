import { describe, expect, it } from "vitest";
import { workEntryHours } from "./routers/shared";

describe("workEntryHours", () => {
  it("soma a duração quando a faixa conta como trabalho", () => {
    expect(
      workEntryHours({
        startedAt: new Date("2026-01-12T08:00:00.000Z"),
        endedAt: new Date("2026-01-12T11:30:00.000Z"),
        countsAsWork: true,
      })
    ).toBe(3.5);
  });

  it("exclui a faixa quando a empresa a classifica como não produtiva", () => {
    expect(
      workEntryHours({
        startedAt: new Date("2026-01-12T12:00:00.000Z"),
        endedAt: new Date("2026-01-12T13:00:00.000Z"),
        countsAsWork: false,
      })
    ).toBe(0);
  });
});
