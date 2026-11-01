export const planIds = ["starter", "growth", "business"] as const;
export type PlanId = (typeof planIds)[number];

export const plans: Record<
  PlanId,
  {
    id: PlanId;
    name: string;
    description: string;
    monthlyPrice: number;
    seatLimit: number;
    highlights: string[];
  }
> = {
  starter: {
    id: "starter",
    name: "Starter",
    description: "Para times que estão organizando a rotina.",
    monthlyPrice: 0,
    seatLimit: 10,
    highlights: [
      "Ponto semanal com aprovação",
      "Reembolsos com recibos",
      "Relatórios e exportação CSV",
    ],
  },
  growth: {
    id: "growth",
    name: "Growth",
    description: "Para operações em expansão com múltiplos fluxos.",
    monthlyPrice: 12,
    seatLimit: 50,
    highlights: [
      "Tudo do Starter",
      "Regras de aprovação por valor e categoria",
      "Feriados e auditoria operacional",
      "Domínio próprio",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    description: "Governança e escala para empresas consolidadas.",
    monthlyPrice: 24,
    seatLimit: 250,
    highlights: [
      "Tudo do Growth",
      "Console de plataforma multiempresa",
      "Prioridade em novas integrações",
      "Suporte dedicado",
    ],
  },
};

export const planList = planIds.map(id => plans[id]);

export function normalizePlan(value: string | null | undefined): PlanId {
  return planIds.includes(value as PlanId) ? (value as PlanId) : "starter";
}
