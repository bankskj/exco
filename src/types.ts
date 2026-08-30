export type Bindings = {
  // Bindings
  DB: D1Database;
  UPLOADS: R2Bucket;
  // Secrets (set with `wrangler secret put`)
  SITE_PASSWORD: string;
  SESSION_SECRET: string;
};

export type Variables = {
  authed: boolean;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
