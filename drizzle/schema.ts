import {
  boolean,
  date,
  decimal,
  double,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
}, table => ({
  emailUnique: uniqueIndex("users_email_unique").on(table.email),
}));

export const tenants = mysqlTable(
  "tenants",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    customDomain: varchar("customDomain", { length: 255 }),
    timezone: varchar("timezone", { length: 80 })
      .default("America/Sao_Paulo")
      .notNull(),
    currency: varchar("currency", { length: 3 }).default("BRL").notNull(),
    locale: varchar("locale", { length: 12 }).default("pt-BR"),
    dateFormat: varchar("dateFormat", { length: 20 }).default("dd/MM/yyyy"),
    legalName: varchar("legalName", { length: 200 }),
    tradeName: varchar("tradeName", { length: 160 }),
    cnpj: varchar("cnpj", { length: 18 }),
    stateRegistration: varchar("stateRegistration", { length: 40 }),
    municipalRegistration: varchar("municipalRegistration", { length: 40 }),
    cnae: varchar("cnae", { length: 20 }),
    legalNature: varchar("legalNature", { length: 120 }),
    taxRegime: varchar("taxRegime", { length: 80 }),
    addressStreet: varchar("addressStreet", { length: 200 }),
    addressNumber: varchar("addressNumber", { length: 30 }),
    addressComplement: varchar("addressComplement", { length: 120 }),
    addressDistrict: varchar("addressDistrict", { length: 120 }),
    addressCity: varchar("addressCity", { length: 120 }),
    addressState: varchar("addressState", { length: 2 }),
    addressPostalCode: varchar("addressPostalCode", { length: 12 }),
    addressCountry: varchar("addressCountry", { length: 60 }).default("Brasil"),
    billingAddressStreet: varchar("billingAddressStreet", { length: 200 }),
    billingAddressNumber: varchar("billingAddressNumber", { length: 30 }),
    billingAddressComplement: varchar("billingAddressComplement", { length: 120 }),
    billingAddressDistrict: varchar("billingAddressDistrict", { length: 120 }),
    billingAddressCity: varchar("billingAddressCity", { length: 120 }),
    billingAddressState: varchar("billingAddressState", { length: 2 }),
    billingAddressPostalCode: varchar("billingAddressPostalCode", { length: 12 }),
    corporateEmail: varchar("corporateEmail", { length: 320 }),
    phone: varchar("phone", { length: 40 }),
    website: varchar("website", { length: 255 }),
    verifiedDomains: json("verifiedDomains").$type<string[]>(),
    logoUrl: text("logoUrl"),
    adminContactName: varchar("adminContactName", { length: 160 }),
    adminContactEmail: varchar("adminContactEmail", { length: 320 }),
    adminContactPhone: varchar("adminContactPhone", { length: 40 }),
    workCalendar: json("workCalendar").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    slugUnique: uniqueIndex("tenants_slug_unique").on(table.slug),
    domainUnique: uniqueIndex("tenants_custom_domain_unique").on(
      table.customDomain
    ),
    cnpjUnique: uniqueIndex("tenants_cnpj_unique").on(table.cnpj),
  })
);

export const departments = mysqlTable(
  "departments",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantNameUnique: uniqueIndex("departments_tenant_name_unique").on(
      table.tenantId,
      table.name
    ),
    tenantIdx: index("departments_tenant_idx").on(table.tenantId),
  })
);

export const memberships = mysqlTable(
  "memberships",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: int("userId").references(() => users.id, { onDelete: "set null" }),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    role: mysqlEnum("role", [
      "tenant_admin",
      "manager",
      "employee",
      "finance",
      "administrative",
    ])
      .default("employee")
      .notNull(),
    departmentId: int("departmentId").references(() => departments.id, {
      onDelete: "set null",
    }),
    managerMembershipId: int("managerMembershipId"),
    active: int("active").default(1).notNull(),
    invitedAt: timestamp("invitedAt").defaultNow().notNull(),
    joinedAt: timestamp("joinedAt"),
  },
  table => ({
    tenantUserUnique: uniqueIndex("memberships_tenant_user_unique").on(
      table.tenantId,
      table.userId
    ),
    tenantEmailUnique: uniqueIndex("memberships_tenant_email_unique").on(
      table.tenantId,
      table.email
    ),
    userIdx: index("memberships_user_idx").on(table.userId),
    tenantIdx: index("memberships_tenant_idx").on(table.tenantId),
  })
);

export const tenantHolidays = mysqlTable(
  "tenant_holidays",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    holidayDate: date("holidayDate", { mode: "string" }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantDateUnique: uniqueIndex("tenant_holidays_tenant_date_unique").on(
      table.tenantId,
      table.holidayDate
    ),
    tenantIdx: index("tenant_holidays_tenant_idx").on(table.tenantId),
  })
);

export const tenantSubscriptions = mysqlTable(
  "tenant_subscriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plan: mysqlEnum("plan", ["starter", "growth", "business"])
      .default("starter")
      .notNull(),
    status: mysqlEnum("status", [
      "trialing",
      "active",
      "past_due",
      "canceled",
    ])
      .default("trialing")
      .notNull(),
    seatLimit: int("seatLimit").default(10).notNull(),
    trialEndsAt: timestamp("trialEndsAt"),
    currentPeriodEnd: timestamp("currentPeriodEnd"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantUnique: uniqueIndex("tenant_subscriptions_tenant_unique").on(
      table.tenantId
    ),
  })
);

export const workSettings = mysqlTable(
  "work_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    dailyHours: decimal("dailyHours", { precision: 4, scale: 2 })
      .default("8.00")
      .notNull(),
    toleranceMinutes: int("toleranceMinutes").default(10).notNull(),
    shiftStart: varchar("shiftStart", { length: 5 }).default("09:00").notNull(),
    markTypes: json("markTypes").$type<string[]>().notNull(),
    nonWorkingMarkTypes: json("nonWorkingMarkTypes").$type<string[]>(),
    customFields: json("customFields").$type<string[]>().notNull(),
    locations: json("locations").$type<string[]>().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantUnique: uniqueIndex("work_settings_tenant_unique").on(table.tenantId),
  })
);

export const workPeriods = mysqlTable(
  "work_periods",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    membershipId: int("membershipId")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    periodStart: date("periodStart", { mode: "string" }).notNull(),
    periodEnd: date("periodEnd", { mode: "string" }).notNull(),
    status: mysqlEnum("status", ["draft", "submitted", "approved", "rejected"])
      .default("draft")
      .notNull(),
    managerNote: text("managerNote"),
    reviewedByMembershipId: int("reviewedByMembershipId").references(
      () => memberships.id,
      { onDelete: "set null" }
    ),
    submittedAt: timestamp("submittedAt"),
    reviewedAt: timestamp("reviewedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantMemberPeriodUnique: uniqueIndex(
      "work_periods_tenant_member_period_unique"
    ).on(table.tenantId, table.membershipId, table.periodStart),
    tenantStatusIdx: index("work_periods_tenant_status_idx").on(
      table.tenantId,
      table.status
    ),
  })
);

export const workEntries = mysqlTable(
  "work_entries",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    periodId: int("periodId")
      .notNull()
      .references(() => workPeriods.id, { onDelete: "cascade" }),
    membershipId: int("membershipId")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    workDate: date("workDate", { mode: "string" }).notNull(),
    startedAt: timestamp("startedAt").notNull(),
    endedAt: timestamp("endedAt").notNull(),
    activity: text("activity").notNull(),
    markType: varchar("markType", { length: 80 }).default("Entrada").notNull(),
    countsAsWork: boolean("countsAsWork").default(true).notNull(),
    project: varchar("project", { length: 160 }),
    costCenter: varchar("costCenter", { length: 120 }),
    locationMode: mysqlEnum("locationMode", ["preset", "geolocation", "manual"])
      .default("preset")
      .notNull(),
    locationName: varchar("locationName", { length: 180 }).notNull(),
    latitude: double("latitude"),
    longitude: double("longitude"),
    customFields: json("customFields").$type<Record<string, string>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantPeriodIdx: index("work_entries_tenant_period_idx").on(
      table.tenantId,
      table.periodId
    ),
    tenantMemberDateIdx: index("work_entries_tenant_member_date_idx").on(
      table.tenantId,
      table.membershipId,
      table.workDate
    ),
  })
);

export const expenseCategories = mysqlTable(
  "expense_categories",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    limitAmount: decimal("limitAmount", { precision: 12, scale: 2 }),
    active: int("active").default(1).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantNameUnique: uniqueIndex("expense_categories_tenant_name_unique").on(
      table.tenantId,
      table.name
    ),
    tenantIdx: index("expense_categories_tenant_idx").on(table.tenantId),
  })
);

export const approvalRules = mysqlTable(
  "approval_rules",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    categoryId: int("categoryId").references(() => expenseCategories.id, {
      onDelete: "cascade",
    }),
    approverLabel: varchar("approverLabel", { length: 100 }).notNull(),
    assignedMembershipId: int("assignedMembershipId").references(
      () => memberships.id,
      { onDelete: "set null" }
    ),
    minAmount: decimal("minAmount", { precision: 12, scale: 2 }),
    maxAmount: decimal("maxAmount", { precision: 12, scale: 2 }),
    priority: int("priority").default(10).notNull(),
    active: int("active").default(1).notNull(),
  },
  table => ({
    tenantPriorityIdx: index("approval_rules_tenant_priority_idx").on(
      table.tenantId,
      table.priority
    ),
  })
);

export const reimbursements = mysqlTable(
  "reimbursements",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    membershipId: int("membershipId")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 180 }).notNull(),
    status: mysqlEnum("status", [
      "draft",
      "submitted",
      "in_approval",
      "approved",
      "paid",
      "rejected",
    ])
      .default("draft")
      .notNull(),
    totalAmount: decimal("totalAmount", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    currentApproverMembershipId: int("currentApproverMembershipId").references(
      () => memberships.id,
      { onDelete: "set null" }
    ),
    paymentMembershipId: int("paymentMembershipId").references(
      () => memberships.id,
      { onDelete: "set null" }
    ),
    rejectionReason: text("rejectionReason"),
    paymentReference: varchar("paymentReference", { length: 160 }),
    paymentNote: text("paymentNote"),
    submittedAt: timestamp("submittedAt"),
    approvedAt: timestamp("approvedAt"),
    paidAt: timestamp("paidAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantStatusIdx: index("reimbursements_tenant_status_idx").on(
      table.tenantId,
      table.status
    ),
    tenantMemberIdx: index("reimbursements_tenant_member_idx").on(
      table.tenantId,
      table.membershipId
    ),
  })
);

export const expenseItems = mysqlTable(
  "expense_items",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    reimbursementId: int("reimbursementId")
      .notNull()
      .references(() => reimbursements.id, { onDelete: "cascade" }),
    categoryId: int("categoryId")
      .notNull()
      .references(() => expenseCategories.id),
    description: varchar("description", { length: 240 }).notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    expenseDate: date("expenseDate", { mode: "string" }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantRequestIdx: index("expense_items_tenant_request_idx").on(
      table.tenantId,
      table.reimbursementId
    ),
  })
);

export const expenseAttachments = mysqlTable(
  "expense_attachments",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    reimbursementId: int("reimbursementId")
      .notNull()
      .references(() => reimbursements.id, { onDelete: "cascade" }),
    itemId: int("itemId").references(() => expenseItems.id, {
      onDelete: "set null",
    }),
    uploadedByMembershipId: int("uploadedByMembershipId")
      .notNull()
      .references(() => memberships.id),
    objectKey: varchar("objectKey", { length: 512 }).notNull(),
    originalName: varchar("originalName", { length: 255 }).notNull(),
    contentType: varchar("contentType", { length: 120 }).notNull(),
    sizeBytes: int("sizeBytes").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantRequestIdx: index("expense_attachments_tenant_request_idx").on(
      table.tenantId,
      table.reimbursementId
    ),
  })
);

export const approvalSteps = mysqlTable(
  "approval_steps",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    reimbursementId: int("reimbursementId")
      .notNull()
      .references(() => reimbursements.id, { onDelete: "cascade" }),
    sequence: int("sequence").notNull(),
    approverMembershipId: int("approverMembershipId").references(
      () => memberships.id,
      { onDelete: "set null" }
    ),
    approverLabel: varchar("approverLabel", { length: 100 }).notNull(),
    status: mysqlEnum("status", ["pending", "approved", "rejected", "skipped"])
      .default("pending")
      .notNull(),
    note: text("note"),
    decidedAt: timestamp("decidedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantRequestIdx: index("approval_steps_tenant_request_idx").on(
      table.tenantId,
      table.reimbursementId
    ),
  })
);

export const tenantAuditLogs = mysqlTable(
  "tenant_audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorMembershipId: int("actorMembershipId").references(
      () => memberships.id,
      { onDelete: "set null" }
    ),
    entityType: varchar("entityType", { length: 80 }).notNull(),
    entityId: int("entityId"),
    action: varchar("action", { length: 80 }).notNull(),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantCreatedIdx: index("tenant_audit_created_idx").on(
      table.tenantId,
      table.createdAt
    ),
  })
);



export const tenantSsoConnections = mysqlTable(
  "tenant_sso_connections",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: mysqlEnum("provider", ["microsoft"]).notNull(),
    microsoftTenantId: varchar("microsoftTenantId", { length: 120 }).notNull(),
    clientId: varchar("clientId", { length: 200 }).notNull(),
    clientSecretEncrypted: text("clientSecretEncrypted"),
    redirectUri: varchar("redirectUri", { length: 500 }).notNull(),
    allowedDomains: json("allowedDomains").$type<string[]>(),
    loginMode: mysqlEnum("loginMode", ["optional", "required"])
      .default("optional")
      .notNull(),
    jitProvisioning: int("jitProvisioning").default(0).notNull(),
    groupMappings: json("groupMappings").$type<Record<string, string>>(),
    enabled: int("enabled").default(1).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantProviderUnique: uniqueIndex("tenant_sso_tenant_provider_unique").on(
      table.tenantId,
      table.provider
    ),
  })
);

export const directorySyncConfigs = mysqlTable(
  "directory_sync_configs",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: mysqlEnum("provider", ["entra", "ad"]).notNull(),
    config: json("config").$type<Record<string, unknown>>(),
    lastSyncAt: timestamp("lastSyncAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantProviderUnique: uniqueIndex("directory_sync_tenant_provider_unique").on(
      table.tenantId,
      table.provider
    ),
  })
);

export const importJobs = mysqlTable(
  "import_jobs",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    type: mysqlEnum("type", ["csv", "entra", "ad"]).notNull(),
    status: mysqlEnum("status", [
      "preview",
      "processing",
      "completed",
      "failed",
    ])
      .default("preview")
      .notNull(),
    fileName: varchar("fileName", { length: 255 }),
    createdByMembershipId: int("createdByMembershipId").references(
      () => memberships.id,
      { onDelete: "set null" }
    ),
    summary: json("summary").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantIdx: index("import_jobs_tenant_idx").on(table.tenantId),
  })
);

export const apiClients = mysqlTable(
  "api_clients",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    clientId: varchar("clientId", { length: 120 }).notNull().unique(),
    clientSecretHash: varchar("clientSecretHash", { length: 255 }).notNull(),
    scopes: json("scopes").$type<string[]>().notNull(),
    active: int("active").default(1).notNull(),
    lastUsedAt: timestamp("lastUsedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantIdx: index("api_clients_tenant_idx").on(table.tenantId),
  })
);

export const webhooks = mysqlTable(
  "webhooks",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    url: varchar("url", { length: 500 }).notNull(),
    secretEncrypted: text("secretEncrypted").notNull(),
    events: json("events").$type<string[]>().notNull(),
    active: int("active").default(1).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantIdx: index("webhooks_tenant_idx").on(table.tenantId),
  })
);

export const webhookDeliveries = mysqlTable(
  "webhook_deliveries",
  {
    id: int("id").autoincrement().primaryKey(),
    webhookId: int("webhookId")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 120 }).notNull(),
    payload: json("payload").$type<Record<string, unknown>>(),
    status: mysqlEnum("status", ["pending", "delivered", "failed"])
      .default("pending")
      .notNull(),
    attempts: int("attempts").default(0).notNull(),
    nextRetryAt: timestamp("nextRetryAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    webhookIdx: index("webhook_deliveries_webhook_idx").on(table.webhookId),
  })
);

export const signatureRequests = mysqlTable(
  "signature_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    tenantId: int("tenantId")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentType: varchar("documentType", { length: 80 }).notNull(),
    documentId: int("documentId"),
    status: mysqlEnum("status", [
      "draft",
      "pending",
      "signed",
      "rejected",
      "expired",
    ])
      .default("draft")
      .notNull(),
    provider: varchar("provider", { length: 80 }).default("internal"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    tenantIdx: index("signature_requests_tenant_idx").on(table.tenantId),
  })
);

export const signatureSigners = mysqlTable(
  "signature_signers",
  {
    id: int("id").autoincrement().primaryKey(),
    requestId: int("requestId")
      .notNull()
      .references(() => signatureRequests.id, { onDelete: "cascade" }),
    membershipId: int("membershipId").references(() => memberships.id, {
      onDelete: "set null",
    }),
    email: varchar("email", { length: 320 }).notNull(),
    signerOrder: int("signerOrder").default(1).notNull(),
    status: mysqlEnum("status", ["pending", "signed", "rejected"])
      .default("pending")
      .notNull(),
    signedAt: timestamp("signedAt"),
  },
  table => ({
    requestIdx: index("signature_signers_request_idx").on(table.requestId),
  })
);

export const signatureEvents = mysqlTable(
  "signature_events",
  {
    id: int("id").autoincrement().primaryKey(),
    requestId: int("requestId")
      .notNull()
      .references(() => signatureRequests.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 120 }).notNull(),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    requestIdx: index("signature_events_request_idx").on(table.requestId),
  })
);

export const platformAuditLogs = mysqlTable(
  "platform_audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    actorUserId: int("actorUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    tenantId: int("tenantId").references(() => tenants.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 120 }).notNull(),
    resource: varchar("resource", { length: 120 }),
    resourceId: int("resourceId"),
    result: varchar("result", { length: 40 }).default("success"),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tenantIdx: index("platform_audit_tenant_idx").on(table.tenantId),
  })
);


export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Tenant = typeof tenants.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type WorkEntry = typeof workEntries.$inferSelect;
export type Reimbursement = typeof reimbursements.$inferSelect;
export type TenantSubscription = typeof tenantSubscriptions.$inferSelect;
export type TenantHoliday = typeof tenantHolidays.$inferSelect;
