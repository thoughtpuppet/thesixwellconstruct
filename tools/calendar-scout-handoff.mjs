import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_ENDPOINT = "https://thesixwellconstruct.com/api/admin/calendar/strong-picks";
const MAX_EVENTS = 50;
const MAX_RESPONSE_BYTES = 64_000;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validPublicUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function calendarScoutHandoffEndpoint(value = DEFAULT_ENDPOINT) {
  const url = new URL(text(value) || DEFAULT_ENDPOINT);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if ((!local && url.protocol !== "https:") || (local && !["http:", "https:"].includes(url.protocol))) {
    throw new Error("Calendar Scout handoff must use HTTPS outside local development.");
  }
  if (!local && url.hostname !== "thesixwellconstruct.com") {
    throw new Error("Calendar Scout handoff may send its credential only to thesixwellconstruct.com.");
  }
  if (url.pathname.replace(/\/+$/, "") !== "/api/admin/calendar/strong-picks" || url.search || url.hash) {
    throw new Error("Calendar Scout handoff URL must be the Strong Picks intake route without query parameters or fragments.");
  }
  return url.toString();
}

export function normalizeCalendarScoutHandoff(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Handoff payload must be a JSON object.");
  const events = Array.isArray(value.events) ? value.events : Array.isArray(value.picks) ? value.picks : [];
  if (!events.length) throw new Error("Handoff payload must include at least one strong event match.");
  if (events.length > MAX_EVENTS) throw new Error(`Handoff payload may include at most ${MAX_EVENTS} events.`);
  const normalizedEvents = events.map((event, index) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error(`Event ${index + 1} must be a JSON object.`);
    if (!text(event.title)) throw new Error(`Event ${index + 1} requires a title.`);
    const verificationState = text(event.verificationState);
    if (!["verified", "needs_verification"].includes(verificationState)) {
      throw new Error(`Event ${index + 1} verificationState must be verified or needs_verification.`);
    }
    if (verificationState === "needs_verification" && !text(event.verificationNotes)) {
      throw new Error(`Event ${index + 1} marked needs_verification requires private verificationNotes.`);
    }
    const evidenceUrls = [event.sourceUrl, event.discoveryUrl, event.announcementUrl, event.ticketUrl].filter(text);
    if (!evidenceUrls.length || evidenceUrls.some((url) => !validPublicUrl(url))) {
      throw new Error(`Event ${index + 1} requires valid public source, discovery, announcement, or ticket evidence.`);
    }
    return event;
  });
  return {
    detectedAt: text(value.detectedAt) || new Date().toISOString(),
    model: text(value.model) || "scheduled-atlanta-creative-scout",
    events: normalizedEvents,
  };
}

async function boundedResponseText(response) {
  const body = await response.text();
  return body.length > MAX_RESPONSE_BYTES ? body.slice(0, MAX_RESPONSE_BYTES) : body;
}

export async function sendCalendarScoutHandoff(value, options = {}) {
  const token = text(options.token ?? process.env.CALENDAR_SCOUT_INGEST_TOKEN);
  if (!token) throw new Error("CALENDAR_SCOUT_INGEST_TOKEN is not configured for this scheduled task.");
  const endpoint = calendarScoutHandoffEndpoint(options.endpoint ?? process.env.CALENDAR_SCOUT_INGEST_URL);
  const payload = normalizeCalendarScoutHandoff(value);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(Number(options.timeoutMs) || 120_000),
  });
  const responseText = await boundedResponseText(response);
  let result = {};
  try { result = responseText ? JSON.parse(responseText) : {}; } catch { /* Error handling below uses the HTTP status. */ }
  if (!response.ok) {
    const detail = text(result.error) || text(result.details) || `HTTP ${response.status}`;
    throw new Error(`Studio rejected the Strong Picks handoff: ${detail}`);
  }
  return {
    runId: text(result.runId),
    status: text(result.status) || "completed",
    candidates: Number(result.candidates) || 0,
    updates: Number(result.updates) || 0,
    unchanged: Number(result.unchanged) || 0,
    duplicates: Number(result.duplicates) || 0,
    suppressed: Number(result.suppressed) || 0,
    failures: Number(result.failures) || 0,
    strongPicks: (Array.isArray(result.strongPicks) ? result.strongPicks : []).map((pick) => ({
      candidateId: text(pick.candidateId),
      title: text(pick.title),
      kind: text(pick.kind),
      detectedAt: text(pick.detectedAt),
      candidateStatus: text(pick.candidateStatus),
      verificationState: text(pick.verificationState),
    })),
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function runCli() {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf("--file");
  if (args.length && (fileIndex < 0 || fileIndex !== 0 || !args[1] || args.length !== 2)) {
    throw new Error("Usage: node tools/calendar-scout-handoff.mjs [--file <payload.json>]");
  }
  const raw = fileIndex === 0 ? await readFile(resolve(args[1]), "utf8") : await readStdin();
  let payload;
  try { payload = JSON.parse(raw); } catch { throw new Error("Calendar Scout handoff input is not valid JSON."); }
  const result = await sendCalendarScoutHandoff(payload);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) runCli().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
