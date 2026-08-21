import { failure, json, readJson, requireStudioAdmin } from "../_shared/construct.js";
import {
  PAGE_VISIBILITY_DEFAULT_RULES,
  isPageVisibilityHomePath,
  isPageVisibilityOperationalExemptPath,
  normalizePageVisibilityPath,
  pageVisibilityRegistryPath,
  presentPageVisibilityState,
  resolvePageVisibility,
} from "../../../shared/page-visibility.js";

const SETTINGS_ID = "public-pages";
const VALID_VISIBILITY = new Set(["public", "hidden"]);
const VALID_SCOPE = new Set(["exact", "descendants"]);

function fallbackState() {
  return { homeOnly: false, rules: PAGE_VISIBILITY_DEFAULT_RULES.map((rule) => ({ ...rule })), source: "fallback" };
}

async function readVisibilityState(env, { allowFallback = false } = {}) {
  if (!env.SUBMISSIONS_DB) {
    if (allowFallback) return fallbackState();
    throw new Error("Missing D1 binding SUBMISSIONS_DB.");
  }
  try {
    const [settings, result] = await Promise.all([
      env.SUBMISSIONS_DB.prepare("SELECT home_only,updated_by,updated_at FROM site_visibility_settings WHERE id=?").bind(SETTINGS_ID).first(),
      env.SUBMISSIONS_DB.prepare("SELECT path,visibility,scope,updated_by,updated_at FROM site_visibility_rules ORDER BY length(path),path").all(),
    ]);
    if (!settings) throw new Error("Page visibility settings are not initialized.");
    return {
      homeOnly: Number(settings.home_only) === 1,
      rules: (result.results || []).map((rule) => ({
        ...rule,
        path: normalizePageVisibilityPath(rule.path),
        visibility: rule.visibility === "hidden" ? "hidden" : "public",
        scope: rule.scope === "descendants" ? "descendants" : "exact",
      })),
      updatedBy: settings.updated_by || "",
      updatedAt: settings.updated_at || "",
      source: "d1",
    };
  } catch (error) {
    if (allowFallback) return { ...fallbackState(), error: String(error?.message || error) };
    throw error;
  }
}

function presentState(state) {
  return {
    homeOnly: state.homeOnly,
    rules: state.rules,
    pages: presentPageVisibilityState(state.rules, state.homeOnly),
    source: state.source,
    updatedBy: state.updatedBy || "",
    updatedAt: state.updatedAt || "",
  };
}

function migrationFailure(error) {
  return failure("Page visibility is unavailable until migration 0157 is applied.", 503, {
    reason: String(error?.message || error),
  });
}

export async function publicPageVisibilityDecision(pathname, env) {
  const state = await readVisibilityState(env, { allowFallback: true });
  return { ...resolvePageVisibility(pathname, state.rules, state.homeOnly), source: state.source };
}

export async function handlePublicSiteVisibility(request, env) {
  if (request.method !== "GET") return failure("Method not allowed.", 405);
  const path = new URL(request.url).searchParams.get("path");
  if (!path || !String(path).startsWith("/")) return failure("Provide an absolute site path.");
  if (isPageVisibilityOperationalExemptPath(path)) {
    return json({ path: normalizePageVisibilityPath(path), visibility: "public", hidden: false, sourcePath: "", scope: "exact", inherited: false, homeOnly: false, source: "exempt" });
  }
  return json(await publicPageVisibilityDecision(path, env));
}

export async function handleAdminSiteVisibility(request, env) {
  const auth = requireStudioAdmin(request, env);
  if (auth) return auth;
  if (!new Set(["GET", "PATCH"]).has(request.method)) return failure("Method not allowed.", 405);

  if (request.method === "GET") {
    try { return json(presentState(await readVisibilityState(env))); }
    catch (error) { return migrationFailure(error); }
  }

  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) return failure("Send a JSON object.");
  const action = String(body.action || "set").trim().toLowerCase();
  const database = env.SUBMISSIONS_DB;
  if (!database) return migrationFailure(new Error("Missing D1 binding SUBMISSIONS_DB."));

  try {
    if (action === "set") {
      const path = pageVisibilityRegistryPath(body.path);
      const visibility = String(body.visibility || "").trim().toLowerCase();
      const scope = String(body.scope || "").trim().toLowerCase();
      if (!path) return failure("Choose a page from the authoritative visibility registry.");
      if (isPageVisibilityHomePath(path)) return failure("Home is always public.", 409);
      if (!VALID_VISIBILITY.has(visibility)) return failure("Visibility must be public or hidden.");
      if (!VALID_SCOPE.has(scope)) return failure("Scope must be exact or descendants.");
      await database.prepare(`INSERT INTO site_visibility_rules(path,visibility,scope,updated_by,updated_at)
        VALUES(?,?,?,'studio',datetime('now'))
        ON CONFLICT(path) DO UPDATE SET visibility=excluded.visibility,scope=excluded.scope,updated_by='studio',updated_at=datetime('now')`)
        .bind(path, visibility, scope).run();
    } else if (action === "home-only") {
      const enabled = body.enabled !== false;
      await database.prepare("UPDATE site_visibility_settings SET home_only=?,updated_by='studio',updated_at=datetime('now') WHERE id=?")
        .bind(enabled ? 1 : 0, SETTINGS_ID).run();
    } else if (action === "show-all") {
      await database.batch([
        database.prepare("UPDATE site_visibility_settings SET home_only=0,updated_by='studio',updated_at=datetime('now') WHERE id=?").bind(SETTINGS_ID),
        database.prepare("DELETE FROM site_visibility_rules"),
      ]);
    } else {
      return failure("Unsupported page visibility action.");
    }
    return json(presentState(await readVisibilityState(env)));
  } catch (error) {
    return migrationFailure(error);
  }
}
