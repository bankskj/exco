import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "./types";
import { checkPassword, startSession, endSession, isAuthed, requireAuth } from "./auth";
import { Landing, Login, Dashboard, SectionStub } from "./views/pages";

const app = new Hono<AppEnv>();

app.use("*", secureHeaders());

// --- Public routes ---------------------------------------------------------

app.get("/", (c) => c.html(<Landing />));

app.get("/login", async (c) => {
  if (await isAuthed(c)) return c.redirect("/app");
  const error = c.req.query("error") === "1";
  return c.html(<Login error={error} />);
});

app.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const password = typeof body.password === "string" ? body.password : "";
  if (await checkPassword(password, c)) {
    await startSession(c);
    return c.redirect("/app");
  }
  return c.redirect("/login?error=1");
});

app.post("/logout", (c) => {
  endSession(c);
  return c.redirect("/");
});

// --- Health check ----------------------------------------------------------

app.get("/healthz", (c) => c.json({ ok: true }));

// --- Protected app ---------------------------------------------------------

app.use("/app/*", requireAuth);
app.use("/app", requireAuth);

app.get("/app", (c) => c.html(<Dashboard />));
app.get("/app/accounts", (c) => c.html(<SectionStub icon="📊" title="Accounts" />));
app.get("/app/payroll", (c) => c.html(<SectionStub icon="💷" title="Payroll" />));
app.get("/app/hr", (c) => c.html(<SectionStub icon="👥" title="HR" />));

// --- 404 -------------------------------------------------------------------

app.notFound((c) => c.html(<Landing />, 404));

export default app;
