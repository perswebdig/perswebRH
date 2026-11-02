export const planIds = ["starter", "growth", "business"] as const;
export type PlanId = (typeof planIds)[number];

// Commercial catalog: fixed monthly price per employee band (BRL cents).
// Legacy ids are kept as technical codes: starter = Essencial,
// growth = Equipe, business = Business.
export const plans: Record<
  PlanId,
  {
    id: PlanId;
    name: string;
    description: string;
    monthlyPriceCents: number;
    seatLimit: number;
    maxEmployees: number;
    minEmployees: number;
    highlights: string[];
  }
> = {
  starter: {
    id: "starter",
    name: "Essencial",
    description: "Até 25 funcionários ativos por R$ 150/mês.",
    monthlyPriceCents: 15000,
    seatLimit: 25,
    maxEmployees: 25,
    minEmployees: 1,
    highlights: [
      "Ponto em tempo real com aprovação",
      "Reembolsos com recibos",
      "Relatórios e exportação CSV",
      "Suporte por e-mail",
    ],
  },
  growth: {
    id: "growth",
    name: "Equipe",
    description: "De 26 a 50 funcionários ativos por R$ 280/mês.",
    monthlyPriceCents: 28000,
    seatLimit: 50,
    maxEmployees: 50,
    minEmployees: 26,
    highlights: [
      "Tudo do Essencial",
      "Regras de aprovação por valor e categoria",
      "Feriados e auditoria operacional",
      "Domínio próprio",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    description: "De 51 a 100 funcionários ativos por R$ 450/mês.",
    monthlyPriceCents: 45000,
    seatLimit: 100,
    maxEmployees: 100,
    minEmployees: 51,
    highlights: [
      "Tudo do Equipe",
      "Console de plataforma multiempresa",
      "Integrações e add-ons",
      "Suporte dedicado",
    ],
  },
};

export const planList = plans;

// Above the last band the product routes to a sales conversation instead of
// inventing a price.
export const COMMERCIAL_THRESHOLD = 100;

export function planForHeadcount(headcount: number): PlanId | null {
  if (headcount <= plans.starter.maxEmployees) return "starter";
  if (headcount <= plans.growth.maxEmployees) return "growth";
  if (headcount <= plans.business.maxEmployees) return "business";
  return null;
}

export function normalizePlan(value: string | null | undefined): PlanId {
  return planIds.includes(value as PlanId) ? (value as PlanId) : "starter";
}

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}
