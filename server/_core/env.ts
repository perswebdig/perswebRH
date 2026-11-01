export const ENV = {
  get appId() {
    return process.env.APP_ID ?? "perswebrh";
  },
  get appSecret() {
    return process.env.APP_SECRET ?? "";
  },
  get cookieSecret() {
    return this.appSecret;
  },
  get databaseUrl() {
    return process.env.DATABASE_URL ?? "";
  },
  get authMode() {
    return (process.env.AUTH_MODE ?? "local").toLowerCase();
  },
  get localAuthEnabled() {
    return true;
  },
  get allowRegistration() {
    return process.env.ALLOW_REGISTRATION !== "false";
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  get ownerOpenId() {
    return process.env.OWNER_OPEN_ID ?? "";
  },
  get platformAdminMode() {
    return this.ownerOpenId ? "owner" : "role";
  },
  get storageDriver() {
    return "local";
  },
  get storageDir() {
    return process.env.STORAGE_DIR ?? "data/storage";
  },
};
