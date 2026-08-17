import { Body, Controller, Get, Header, Headers, Post, Res } from "@nestjs/common";
import type { ServerResponse } from "node:http";

const sessionCookieName = "meetx_session";

type LoginBody = {
  email?: string;
  organization?: string;
};

export type PrototypeSession = {
  email: string;
  organization: string;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function encodeSession(session: PrototypeSession): string {
  return Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
}

function decodeSession(rawCookie: string | undefined): PrototypeSession | undefined {
  if (rawCookie === undefined) {
    return undefined;
  }

  const cookie = rawCookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`));

  if (cookie === undefined) {
    return undefined;
  }

  try {
    const token = cookie.slice(`${sessionCookieName}=`.length);
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Partial<PrototypeSession>;
    if (typeof parsed.email !== "string" || typeof parsed.organization !== "string") {
      return undefined;
    }
    return { email: parsed.email, organization: parsed.organization };
  } catch {
    return undefined;
  }
}

export function getPrototypeSession(cookieHeader: string | undefined): PrototypeSession | undefined {
  return decodeSession(cookieHeader);
}

export function requirePrototypeSession(cookieHeader: string | undefined): PrototypeSession {
  return decodeSession(cookieHeader) ?? {
    email: "founder@meet-x.local",
    organization: "Meet-X Local Workspace"
  };
}

export function renderSaasShell(input: { title: string; active: "dashboard" | "library" | "recorder" | "settings" | "billing"; session: PrototypeSession; body: string }): string {
  const navItem = (href: string, label: string, active: boolean): string => `<a class="nav ${active ? "active" : ""}" href="${href}">${label}</a>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#f5f5f7" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <title>${escapeHtml(input.title)} - Meet-X</title>
    <style>
      :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Inter, "Segoe UI", sans-serif; color: #1d1d1f; background: #f5f5f7; --ink:#1d1d1f; --muted:#6e6e73; --line:rgba(0,0,0,.08); --panel:rgba(255,255,255,.78); --panel-strong:#fff; --accent:#0071e3; --accent-soft:#e8f2ff; --green:#24c58f; }
      * { box-sizing: border-box; }
      body { margin: 0; height: 100dvh; overflow: hidden; background: radial-gradient(circle at 16% 0%, rgba(0,113,227,.12), transparent 32rem), radial-gradient(circle at 100% 0%, rgba(36,197,143,.12), transparent 26rem), #f5f5f7; }
      .layout { display: grid; grid-template-columns: 272px minmax(0, 1fr); height: 100dvh; overflow: hidden; }
      aside { border-right: 1px solid var(--line); background: rgba(255,255,255,.64); backdrop-filter: blur(24px); padding: 24px; height: 100dvh; overflow: auto; }
      main { height: 100dvh; min-width: 0; overflow: hidden; padding: 24px clamp(18px, 3vw, 42px); display: grid; grid-template-rows: auto minmax(0, 1fr); }
      .content-scroll { min-height: 0; overflow: auto; padding-right: 8px; }
      .brand { font-size: 25px; font-weight: 800; letter-spacing: -.035em; margin-bottom: 22px; color: var(--ink); }
      .workspace { border: 1px solid var(--line); border-radius: 22px; padding: 15px; background: rgba(255,255,255,.74); box-shadow: 0 10px 30px rgba(0,0,0,.04); margin-bottom: 20px; }
      .workspace strong { display: block; font-size: 15px; letter-spacing: -.01em; }
      .workspace small, p, li, td, th, dd { color: var(--muted); line-height: 1.55; }
      .nav { display: flex; align-items:center; padding: 12px 14px; color: #424245; text-decoration: none; border-radius: 16px; margin-bottom: 7px; font-weight: 700; transition: .18s ease; }
      .nav.active, .nav:hover { color: var(--ink); background: rgba(0,113,227,.1); }
      .topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 18px; }
      h1 { margin: 0 0 8px; font-size: clamp(36px, 5vw, 62px); line-height: .94; letter-spacing: -.07em; color: var(--ink); }
      h2 { margin: 0 0 14px; font-size: 24px; letter-spacing: -.04em; color: var(--ink); }
      h3 { margin: 0 0 8px; font-size: 17px; letter-spacing: -.02em; color: var(--ink); }
      .eyebrow { color: var(--muted); font-size: 14px; font-weight: 700; }
      .card { border: 1px solid var(--line); border-radius: 30px; background: var(--panel); box-shadow: 0 24px 70px rgba(0,0,0,.07); padding: 22px; margin-bottom: 16px; backdrop-filter: blur(22px); }
      .card.subtle { box-shadow: none; background: rgba(255,255,255,.56); }
      .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
      .two { display: grid; grid-template-columns: .9fr 1.1fr; gap: 20px; align-items: stretch; min-height: 0; }
      .two > .card { max-height: calc(100dvh - 190px); overflow: auto; }
      .card:has(table) { overflow: auto; }
      .metric { font-size: 46px; font-weight: 800; letter-spacing: -.055em; color: var(--ink); }
      .button, button { display: inline-flex; align-items:center; justify-content:center; border: 0; border-radius: 999px; padding: 12px 18px; background: var(--accent); color: #fff; font-weight: 750; cursor: pointer; text-decoration: none; box-shadow: 0 10px 24px rgba(0,113,227,.2); }
      .button.secondary, button.secondary { background: rgba(0,0,0,.06); color: var(--ink); box-shadow: none; }
      .button.ghost, button.ghost { background: transparent; color: var(--accent); box-shadow: none; }
      a { color: var(--accent); text-decoration: none; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; }
      td, th { text-align: left; padding: 14px 16px; border-bottom: 1px solid var(--line); }
      th { color: #424245; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; }
      .status { display: inline-flex; border-radius: 999px; padding: 6px 10px; background: #eef7f3; border: 1px solid rgba(36,197,143,.2); color: #147a5a; font-size: 12px; font-weight: 800; text-transform: uppercase; }
      .status.warn { background:#fff7e8; border-color:#f1cf8b; color:#946200; }
      .status.blue { background:var(--accent-soft); border-color:rgba(0,113,227,.16); color:#0756a5; }
      video, audio { width: 100%; border-radius: 24px; background: #000; box-shadow: 0 18px 50px rgba(0,0,0,.12); }
      audio { background: rgba(255,255,255,.84); padding: 12px; }
      .segment { border: 1px solid var(--line); border-radius: 22px; padding: 16px; margin-bottom: 12px; background: rgba(255,255,255,.72); }
      .segment:target { outline: 3px solid rgba(0,113,227,.24); background: #fff; }
      .segment div { display: flex; justify-content: space-between; gap: 12px; color: var(--ink); }
      code { display: block; white-space: pre-wrap; word-break: break-word; background: rgba(0,0,0,.045); color: #424245; border-radius: 18px; padding: 14px; }
      form.inline { display: inline; }
      label { display:block; margin: 14px 0 7px; color:#424245; font-size:13px; font-weight:800; }
      input, textarea, select { width:100%; border:1px solid var(--line); border-radius:16px; padding:13px 14px; background:rgba(255,255,255,.78); color:var(--ink); font:inherit; outline:none; }
      input:focus, textarea:focus, select:focus { border-color:rgba(0,113,227,.45); box-shadow:0 0 0 4px rgba(0,113,227,.1); }
      textarea { min-height: 110px; resize: vertical; }
      dl { display:grid; grid-template-columns: 140px 1fr; gap: 8px 16px; margin: 12px 0 20px; }
      dt { color:#424245; font-weight:800; }
      dd { margin:0; }
      .setting-row { display:grid; grid-template-columns: 1fr 1.4fr; gap:18px; padding:18px 0; border-top:1px solid var(--line); align-items:start; }
      .pill-row { display:flex; flex-wrap:wrap; gap:10px; }
      .mini { font-size:13px; color:var(--muted); }
      @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } aside { display: none; } main { padding: 16px; } .grid, .two, .setting-row { grid-template-columns: 1fr; } h1 { font-size: 46px; } }
    </style>
  </head>
  <body>
    <div class="layout">
      <aside>
        <div class="brand">Meet-X</div>
        <div class="workspace"><strong>${escapeHtml(input.session.organization)}</strong><small>${escapeHtml(input.session.email)}</small></div>
        ${navItem("/app", "Dashboard", input.active === "dashboard")}
        ${navItem("/library", "Meeting library", input.active === "library")}
        ${navItem("/recorder", "Recorder", input.active === "recorder")}
        ${navItem("/settings", "Settings", input.active === "settings")}
        ${navItem("/billing", "Billing", input.active === "billing")}
        <form class="inline" method="post" action="/api/auth/logout"><button class="secondary" style="margin-top:16px">Log out</button></form>
      </aside>
      <main>
        <div class="topbar"><div><h1>${escapeHtml(input.title)}</h1><div class="eyebrow">Personal meeting intelligence, running locally first.</div></div><div class="pill-row"><button id="desktopAppButton" class="secondary" type="button">Open desktop app</button><a class="button" href="/recorder">New recording</a></div></div>        <div class="content-scroll">${input.body}</div>
      </main>
    </div>
    <script>
if ("serviceWorker" in navigator) { navigator.serviceWorker.register("/sw.js").catch(() => undefined); }
const desktopAppButton = document.getElementById("desktopAppButton");
desktopAppButton?.addEventListener("click", async () => {
  desktopAppButton.disabled = true;
  desktopAppButton.textContent = "Opening desktop app...";
  try {
    const response = await fetch("/api/local-agent/launch", { method: "POST" });
    const result = await response.json();
    desktopAppButton.textContent = result.status === "running" ? "Desktop app is open" : result.status === "launched" ? "Desktop app opened" : "Desktop app unavailable";
  } catch {
    desktopAppButton.textContent = "Could not open desktop app";
  } finally {
    window.setTimeout(() => { desktopAppButton.textContent = "Open desktop app"; desktopAppButton.disabled = false; }, 3000);
  }
});</script>
  </body>
</html>`;
}

@Controller()
export class AuthController {
  @Get("/login")
  @Header("Content-Type", "text/html; charset=utf-8")
  login(@Headers("cookie") cookieHeader: string | undefined): string {
    const session = getPrototypeSession(cookieHeader);
    if (session !== undefined) {
      return `<script>window.location.href = "/app";</script>`;
    }

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#f5f5f7" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <title>Meet-X Login</title>
    <style>
      :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Inter, "Segoe UI", sans-serif; color:#1d1d1f; background:#f5f5f7; }
      body { margin:0; min-height:100vh; display:grid; place-items:center; background: radial-gradient(circle at 18% 0%, rgba(0,113,227,.16), transparent 32rem), radial-gradient(circle at 100% 10%, rgba(36,197,143,.14), transparent 28rem), #f5f5f7; }
      main { width:min(460px, calc(100vw - 32px)); border:1px solid rgba(0,0,0,.08); border-radius:34px; padding:32px; background:rgba(255,255,255,.78); box-shadow:0 24px 70px rgba(0,0,0,.08); backdrop-filter: blur(22px); }
      h1 { margin:0 0 10px; font-size:58px; letter-spacing:-.07em; }
      p { color:#6e6e73; line-height:1.55; }
      label { display:block; margin:14px 0 6px; color:#424245; font-weight:800; font-size:13px; }
      input { box-sizing:border-box; width:100%; border:1px solid rgba(0,0,0,.08); border-radius:16px; padding:13px; background:rgba(255,255,255,.8); color:#1d1d1f; font:inherit; }
      button { width:100%; margin-top:18px; border:0; border-radius:999px; padding:13px 16px; background:#0071e3; color:#fff; font-weight:800; cursor:pointer; }
      small { color:#86868b; }
    </style>
  </head>
  <body>
    <main>
      <h1>Meet-X</h1>
      <p>Sign into your local workspace. This installable PWA shell runs the web experience; desktop meeting detection will use the companion desktop agent.</p>
      <label>Email</label><input id="email" value="founder@meet-x.local" />
      <label>Workspace</label><input id="organization" value="Meet-X Local Workspace" />
      <button id="loginButton">Enter workspace</button>
      <p><small>Production auth later becomes OIDC/SAML + SCIM. This local login keeps the prototype fast.</small></p>
    </main>
    <script>
      if ("serviceWorker" in navigator) { navigator.serviceWorker.register("/sw.js").catch(() => undefined); }
      document.getElementById("loginButton").addEventListener("click", async () => {
        const email = document.getElementById("email").value;
        const organization = document.getElementById("organization").value;
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, organization })
        });
        if (response.ok) { window.location.href = "/app"; }
      });
    </script>
  </body>
</html>`;
  }

  @Post("/api/auth/login")
  loginAction(@Body() body: LoginBody, @Res({ passthrough: true }) response: ServerResponse): { ok: true; redirectTo: string } {
    const session: PrototypeSession = {
      email: body.email?.trim() || "founder@meet-x.local",
      organization: body.organization?.trim() || "Meet-X Local Workspace"
    };
    response.setHeader("Set-Cookie", `${sessionCookieName}=${encodeSession(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
    return { ok: true, redirectTo: "/app" };
  }

  @Post("/api/auth/logout")
  logout(@Res({ passthrough: true }) response: ServerResponse): string {
    response.setHeader("Set-Cookie", `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    response.statusCode = 302;
    response.setHeader("Location", "/login");
    return "";
  }
}


