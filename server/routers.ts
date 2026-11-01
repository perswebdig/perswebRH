import { publicProcedure, router } from "./_core/trpc";
import { systemRouter } from "./_core/systemRouter";
import { authRouter } from "./routers/auth";
import { tenantsRouter } from "./routers/tenants";
import { attendanceRouter } from "./routers/attendance";
import { reimbursementsRouter } from "./routers/reimbursements";
import { importsRouter } from "./routers/imports";
import { signaturesRouter } from "./routers/signatures";
import { apiManagementRouter } from "./routers/apiManagement";

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  tenants: tenantsRouter,
  attendance: attendanceRouter,
  reimbursements: reimbursementsRouter,
  imports: importsRouter,
  signatures: signaturesRouter,
  api: apiManagementRouter,
});

export type AppRouter = typeof appRouter;
