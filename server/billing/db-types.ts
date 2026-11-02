import type { drizzle } from "drizzle-orm/mysql2";

// The pooled database handle used by shared helpers. Transactions are cast
// to this shape where needed (same query API, without $client).
export type Db = ReturnType<typeof drizzle>;
