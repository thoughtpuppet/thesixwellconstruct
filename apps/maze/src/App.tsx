import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import type Konva from "konva";
import { ArrowLeft, Magnet, Redo2, Send, Undo2 } from "lucide-react";
import { ConstructCanvas } from "./components/ConstructCanvas";
import { Inspector } from "./components/Inspector";
import { MazeTools } from "./components/MazeTools";
import {
  CANVAS_LAYOUT_OPTIONS,
  CANVAS_LAYOUTS,
  defaultCanvasLayout,
  fitMazeToLayout,
  isCanvasLayout
} from "./lib/canvas-layout";
import {
  CANVAS_TONES,
  DEFAULT_CANVAS_TONE,
  NEGATIVE_SPACE_CANVAS_COLOR,
  canvasToneColor,
  defaultInkColorForMode,
  isCanvasMode,
  isCanvasTone,
  normalizeMazeColor,
  sanitizeToolForCanvasMode,
  switchCanvasMode,
  switchCanvasTone
} from "./lib/canvas-mode";
import { shapeTouchedByEraser, splitWallByEraser } from "./lib/maze";
import type { CanvasLayout, CanvasMode, CanvasReference, CanvasTone, MazeShape, MazeState, MazeTool, MazeWall, Selection, ShapeSizeScope } from "./types";
import "./maze-submit.css";

const LEGACY_STORAGE_KEY = "art-pill-maze-design";
const PREVIOUS_STORAGE_KEY = "art-pill-maze-draft:v1";
const STORAGE_KEY = "art-pill-maze-draft:v2";
const TOKEN_STORAGE_KEY = "art-pill-maze-resume-token";
const SUBMISSION_IDEMPOTENCY_KEY = "sixwell:submission-idempotency:/tattoos/build/maze/:maze-form";
const MAX_UNDO_STEPS = 60;
const AUTOSAVE_DELAY_MS = 600;
const REFERENCE_MAX_BYTES = 15 * 1024 * 1024;
const REFERENCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DEFAULT_SHAPE_SIZE = 54;
const MIN_SHAPE_SIZE = 24;
const MAX_SHAPE_SIZE = 360;
const KIOSK = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("kiosk");
const PREVIEW = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("preview") === "1";
const KIOSK_IDLE_MS = 150000;

type MazeFormDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  placement: string;
  scale: string;
  budgetRange: string;
  mazeExplanation: string;
};

type MazeDraftPayload = MazeState & {
  version: 1;
  clientDraftId: string;
  contact: Pick<MazeFormDraft, "firstName" | "lastName" | "email" | "phone" | "dateOfBirth">;
  placement: string;
  scale: string;
  budgetRange: string;
  mazeExplanation: string;
  updatedAt: string;
};

type MazeDraftEnvelope = {
  state: MazeState;
  form: MazeFormDraft;
  clientDraftId: string;
  serverDraftId: string;
  serverRevision: number;
};

type ServerDraft = {
  id: string;
  revision: number;
  email: string;
  payload: MazeDraftPayload;
};

function emptyState(
  canvasLayout = defaultCanvasLayout(),
  canvasMode: CanvasMode = "standard",
  canvasTone: CanvasTone = DEFAULT_CANVAS_TONE
): MazeState {
  return { canvasLayout, canvasMode, canvasTone, mazeWalls: [], mazeShapes: [] };
}

function normalizeMazeState(value: Partial<MazeState> | null | undefined, emptyLayout = defaultCanvasLayout()): MazeState {
  const mazeWalls = Array.isArray(value?.mazeWalls)
    ? value.mazeWalls.map((wall) => ({ ...wall, stroke: normalizeMazeColor(wall.stroke) }))
    : [];
  const mazeShapes = Array.isArray(value?.mazeShapes)
    ? value.mazeShapes.map((shape) => ({
        ...shape,
        stroke: normalizeMazeColor(shape.stroke),
        fill: normalizeMazeColor(shape.fill)
      }))
    : [];
  const canvasLayout = isCanvasLayout(value?.canvasLayout)
    ? value.canvasLayout
    : mazeWalls.length || mazeShapes.length
      ? "wide"
      : emptyLayout;
  const canvasMode = isCanvasMode(value?.canvasMode) ? value.canvasMode : "standard";
  const canvasTone = isCanvasTone(value?.canvasTone) ? value.canvasTone : DEFAULT_CANVAS_TONE;
  return { canvasLayout, canvasMode, canvasTone, mazeWalls, mazeShapes };
}

function emptyForm(): MazeFormDraft {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    placement: "",
    scale: "",
    budgetRange: "",
    mazeExplanation: ""
  };
}

function clone(state: MazeState): MazeState {
  return JSON.parse(JSON.stringify(state)) as MazeState;
}

function byZ<T extends { zIndex: number }>(a: T, b: T) {
  return a.zIndex - b.zIndex;
}

function loadDraft(): MazeDraftEnvelope {
  const fallback: MazeDraftEnvelope = {
    state: emptyState(),
    form: emptyForm(),
    clientDraftId: crypto.randomUUID(),
    serverDraftId: "",
    serverRevision: 0
  };
  if (KIOSK || PREVIEW) return fallback;
  try {
    const current = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(PREVIOUS_STORAGE_KEY);
    if (current) {
      const parsed = JSON.parse(current) as Partial<MazeDraftEnvelope> & Partial<MazeState>;
      const storedState = parsed.state || parsed;
      return {
        state: normalizeMazeState(storedState, fallback.state.canvasLayout),
        form: { ...emptyForm(), ...(parsed.form || {}) },
        clientDraftId: parsed.clientDraftId || fallback.clientDraftId,
        serverDraftId: parsed.serverDraftId || "",
        serverRevision: Number(parsed.serverRevision || 0)
      };
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return fallback;
    const parsed = JSON.parse(legacy) as Partial<MazeState>;
    return {
      ...fallback,
      state: normalizeMazeState(parsed, fallback.state.canvasLayout)
    };
  } catch {
    return fallback;
  }
}

function captureResumeToken() {
  if (KIOSK || PREVIEW) return "";
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const linked = fragment.get("resume") || "";
  if (linked) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    try { sessionStorage.setItem(TOKEN_STORAGE_KEY, linked); } catch { /* storage can be unavailable */ }
    return linked;
  }
  try { return sessionStorage.getItem(TOKEN_STORAGE_KEY) || ""; } catch { return ""; }
}

function clearResumeToken() {
  try { sessionStorage.removeItem(TOKEN_STORAGE_KEY); } catch { /* storage can be unavailable */ }
}

function draftPayload(state: MazeState, form: MazeFormDraft, clientDraftId: string): MazeDraftPayload {
  return {
    version: 1,
    clientDraftId,
    canvasLayout: state.canvasLayout,
    canvasMode: state.canvasMode,
    canvasTone: state.canvasTone,
    mazeWalls: state.mazeWalls,
    mazeShapes: state.mazeShapes,
    contact: {
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      phone: form.phone,
      dateOfBirth: form.dateOfBirth
    },
    placement: form.placement,
    scale: form.scale,
    budgetRange: form.budgetRange,
    mazeExplanation: form.mazeExplanation,
    updatedAt: new Date().toISOString()
  };
}

function payloadToForm(payload: Partial<MazeDraftPayload>): MazeFormDraft {
  return {
    ...emptyForm(),
    ...(payload.contact || {}),
    placement: payload.placement || "",
    scale: payload.scale || "",
    budgetRange: payload.budgetRange || "",
    mazeExplanation: payload.mazeExplanation || ""
  };
}

function nextZIndex(state: MazeState) {
  const zIndexes = [
    ...state.mazeWalls.map((wall) => wall.zIndex),
    ...state.mazeShapes.map((shape) => shape.zIndex)
  ];
  return (zIndexes.length ? Math.max(...zIndexes) : 0) + 1;
}

function downloadFile(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const mime = head.match(/:(.*?);/)?.[1] ?? "image/png";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

type MazeImageVariant = "canvas" | "transparent" | "stencil";

function captureMazeImage(stage: Konva.Stage | null, variant: MazeImageVariant = "canvas"): string | null {
  if (!stage) return null;
  const utilityNodes = [
    ...stage.find(".maze-reference"),
    ...stage.find(".maze-snap-guide"),
    ...stage.find(".maze-export-affordance")
  ];
  const backgroundNodes = variant === "canvas" ? [] : [...stage.find(".canvas-background")];
  const hiddenNodes = [...new Set([...utilityNodes, ...backgroundNodes])];
  const wallNodes = variant === "stencil" ? [...stage.find(".maze-wall-render")] : [];
  const shapeNodes = variant === "stencil" ? [...stage.find(".maze-shape-render")] : [];
  const visibility = hiddenNodes.map((node) => node.visible());
  const wallStyles = wallNodes.map((node) => ({ stroke: node.getAttr("stroke") }));
  const shapeStyles = shapeNodes.map((node) => ({
    fill: node.getAttr("fill"),
    stroke: node.getAttr("stroke"),
    strokeWidth: node.getAttr("strokeWidth")
  }));

  hiddenNodes.forEach((node) => node.visible(false));
  wallNodes.forEach((node) => node.setAttr("stroke", NEGATIVE_SPACE_CANVAS_COLOR));
  shapeNodes.forEach((node) => node.setAttrs({
    fill: "transparent",
    stroke: NEGATIVE_SPACE_CANVAS_COLOR,
    strokeWidth: 5
  }));
  stage.draw();
  try {
    const stageScale = stage.scaleX() || 1;
    return stage.toDataURL({ pixelRatio: 2 / stageScale });
  } finally {
    hiddenNodes.forEach((node, index) => node.visible(visibility[index]));
    wallNodes.forEach((node, index) => node.setAttrs(wallStyles[index]));
    shapeNodes.forEach((node, index) => node.setAttrs(shapeStyles[index]));
    stage.draw();
  }
}

function mazeSubmissionIdempotencyKey() {
  try {
    const saved = sessionStorage.getItem(SUBMISSION_IDEMPOTENCY_KEY);
    if (saved) return saved;
    const key = crypto.randomUUID();
    sessionStorage.setItem(SUBMISSION_IDEMPOTENCY_KEY, key);
    return key;
  } catch {
    return crypto.randomUUID();
  }
}

function clearMazeSubmissionIdempotencyKey() {
  try { sessionStorage.removeItem(SUBMISSION_IDEMPOTENCY_KEY); } catch { /* storage can be unavailable */ }
}

// Submit a finished maze into the same review -> booking pipeline as a brief.
// Captures the final Maze render variants + JSON, collects contact details and an explanation,
// and posts as a `maze_design` submission.
function SubmitDialog({
  open,
  onClose,
  capturePng,
  canvasMode,
  getJson,
  isEmpty,
  formDraft,
  onFormDraftChange,
  resumeToken,
  ownerEmail,
  onSubmitted
}: {
  open: boolean;
  onClose: () => void;
  capturePng: (variant: MazeImageVariant) => string | null;
  canvasMode: CanvasMode;
  getJson: () => string;
  isEmpty: boolean;
  formDraft: MazeFormDraft;
  onFormDraftChange: (next: MazeFormDraft) => void;
  resumeToken: string;
  ownerEmail: string;
  onSubmitted: () => void;
}) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [archiveOptIn, setArchiveOptIn] = useState(false);
  const [archiveAttribution, setArchiveAttribution] = useState("anonymous");
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);

  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
      ) ?? [])].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    if (isEmpty) {
      setStatus("Draw at least one wall or shape before submitting.");
      return;
    }

    if (PREVIEW) {
      setStatus("Preview mode is read-only. Your maze was not submitted.");
      return;
    }

    setBusy(true);
    setStatus("Capturing your maze for review.");

    try {
      const fd = new FormData(form);
      fd.set("type", "maze_design");
      fd.set("source_path", "/tattoos/build/maze/");
      fd.set("subject", "New Art.Pill Build a Maze submission");
      fd.set("review_consent", "yes");

      const canvasPng = capturePng("canvas");
      const transparentPng = canvasMode === "standard" ? capturePng("transparent") : null;
      const stencilPng = capturePng("stencil");
      const mazeJson = getJson();
      if (!canvasPng || !stencilPng || (canvasMode === "standard" && !transparentPng)) {
        throw new Error("The maze image variants could not be captured. Wait a moment and try again.");
      }
      if (!mazeJson) throw new Error("The maze project file could not be created. Try again.");
      fd.set("maze_image", dataUrlToBlob(canvasPng), "maze.png");
      if (transparentPng) {
        fd.set("maze_transparent_image", dataUrlToBlob(transparentPng), "maze-transparent.png");
      }
      fd.set("maze_stencil_image", dataUrlToBlob(stencilPng), "maze-stencil.png");
      fd.set("maze_json_file", new Blob([mazeJson], { type: "application/json" }), "maze.json");

      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: {
          "idempotency-key": mazeSubmissionIdempotencyKey(),
          ...(resumeToken ? { "x-build-draft-token": resumeToken } : {})
        },
        body: fd
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string; submissionId?: string };
      if (!res.ok) throw new Error(payload.error || "Submission failed.");
      const destination = new URL("/tattoos/submission-received/", window.location.origin);
      destination.searchParams.set("type", "maze");
      if (payload.submissionId) destination.searchParams.set("ref", payload.submissionId);
      clearMazeSubmissionIdempotencyKey();
      onSubmitted();
      window.location.href = `${destination.pathname}${destination.search}`;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Submission failed. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div ref={dialogRef} className="maze-submit-overlay" role="dialog" aria-modal="true" aria-labelledby="maze-submit-title" aria-describedby="maze-submit-note">
      <div className="maze-submit-panel">
        <div className="maze-submit-head">
          <h2 id="maze-submit-title">Submit your maze</h2>
          <button ref={closeButtonRef} type="button" className="maze-submit-close" onClick={onClose} disabled={busy} aria-label="Close submit dialog">
            &times;
          </button>
        </div>
        <p className="maze-submit-note" id="maze-submit-note">
          Your maze is captured as an image and sent for review. If it fits, a private booking link
          follows. You create the final tattoo from this design.
        </p>
        {isEmpty ? (
          <p className="maze-submit-warn" role="alert">Draw at least one wall or shape before submitting.</p>
        ) : null}
        <form onSubmit={handleSubmit}>
          <div className="maze-submit-grid">
            <label>First name<input name="firstName" autoComplete="given-name" required value={formDraft.firstName} onChange={(event) => onFormDraftChange({ ...formDraft, firstName: event.target.value })} /></label>
            <label>Last name<input name="lastName" autoComplete="family-name" required value={formDraft.lastName} onChange={(event) => onFormDraftChange({ ...formDraft, lastName: event.target.value })} /></label>
            <label>Email<input name="email" type="email" autoComplete="email" required readOnly={Boolean(ownerEmail)} value={formDraft.email} onChange={(event) => onFormDraftChange({ ...formDraft, email: event.target.value })} /></label>
            <label>Phone (optional)<input name="phone" autoComplete="tel" value={formDraft.phone} onChange={(event) => onFormDraftChange({ ...formDraft, phone: event.target.value })} /></label>
            <label>Date of birth<input name="dob" type="date" autoComplete="bday" required value={formDraft.dateOfBirth} onChange={(event) => onFormDraftChange({ ...formDraft, dateOfBirth: event.target.value })} /></label>
            <label>Placement (optional)<input name="placement" placeholder="e.g. forearm, spine" value={formDraft.placement} onChange={(event) => onFormDraftChange({ ...formDraft, placement: event.target.value })} /></label>
            <label>Approx. scale (optional)<input name="scale" placeholder="e.g. palm-size" value={formDraft.scale} onChange={(event) => onFormDraftChange({ ...formDraft, scale: event.target.value })} /></label>
          </div>
          <label className="maze-submit-full">
            What total project budget are you comfortable working within?
            <select name="budget_range" required aria-describedby="maze-budget-help" value={formDraft.budgetRange} onChange={(event) => onFormDraftChange({ ...formDraft, budgetRange: event.target.value })}>
              <option value="">Select a range</option>
              <option value="Up to $300">Up to $300</option>
              <option value="$300–$500">$300–$500</option>
              <option value="$500–$800">$500–$800</option>
              <option value="$800–$1,200">$800–$1,200</option>
              <option value="$1,200–$2,000">$1,200–$2,000</option>
              <option value="$2,000+">$2,000+</option>
              <option value="I’m flexible / I’d like guidance">I’m flexible / I’d like guidance</option>
            </select>
            <span className="maze-submit-help" id="maze-budget-help">This helps me recommend an appropriate size, level of detail, and session plan. It does not determine your final quote. One developed design direction is included after your deposit is paid. Additional concept sketches are $50 each, require artist approval, and must be paid before drawing begins.</span>
          </label>
          <label className="maze-submit-full">
            What does this maze carry?
            <textarea name="maze_explanation" rows={4} required placeholder="Explain the meaning, the path, what it should hold." value={formDraft.mazeExplanation} onChange={(event) => onFormDraftChange({ ...formDraft, mazeExplanation: event.target.value })} />
          </label>
          <fieldset className="maze-archive-consent-block">
            <legend>Public Maze Archive (optional)</legend>
            <label className="maze-submit-consent">
              <input type="checkbox" name="maze_archive_opt_in" value="yes" checked={archiveOptIn} onChange={(event) => setArchiveOptIn(event.target.checked)} />
              <span>Consider my maze for the public Maze Archive. If selected after review, I grant Art.Pill and the Six.Well Construct a limited, non-exclusive, revocable permission to display the maze image. I keep ownership, and submitting does not guarantee publication.</span>
            </label>
            <p className="maze-submit-help">Your contact details and editable Maze JSON remain private. Only a separately reviewed image copy can enter the Archive.</p>
            {archiveOptIn ? (
              <div className="maze-archive-consent-options">
                <label>
                  Public attribution
                  <select name="maze_archive_attribution" value={archiveAttribution} onChange={(event) => setArchiveAttribution(event.target.value)}>
                    <option value="anonymous">Anonymous (default)</option>
                    <option value="first_name">First name</option>
                    <option value="display_name">Custom display name</option>
                  </select>
                </label>
                {archiveAttribution === "display_name" ? (
                  <label>Custom display name<input name="maze_archive_display_name" maxLength={80} required /></label>
                ) : null}
                <label className="maze-submit-consent">
                  <input type="checkbox" name="maze_archive_include_explanation" value="yes" />
                  <span>Allow my personal explanation to be considered separately for public display. It will not be copied automatically.</span>
                </label>
              </div>
            ) : null}
          </fieldset>
          <label className="maze-submit-consent">
            <input type="checkbox" name="age_confirmed" value="yes" required />
            <span>I confirm that I am 18 years of age or older.</span>
          </label>
          <label className="maze-submit-consent">
            <input type="checkbox" name="review_consent" value="yes" required />
            <span>I understand this is reviewed before a private booking link is sent, and submitting does not guarantee a session.</span>
          </label>
          <div className="maze-submit-actions">
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" disabled={busy || isEmpty} className="primary">
              {busy ? "Submitting…" : "Submit maze"}
            </button>
          </div>
          {status ? <p className="maze-submit-status" role="status" aria-live="polite">{status}</p> : null}
        </form>
      </div>
    </div>
  );
}

function SaveEmailDialog({
  open,
  email,
  busy,
  status,
  onClose,
  onSave
}: {
  open: boolean;
  email: string;
  busy: boolean;
  status: string;
  onClose: () => void;
  onSave: (email: string) => void;
}) {
  const [value, setValue] = useState(email);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(busy);
  const closeRef = useRef(onClose);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    setValue(email);
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => emailRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [open, email]);
  if (!open) return null;
  return (
    <div className="maze-submit-overlay" role="dialog" aria-modal="true" aria-labelledby="maze-save-title" aria-describedby="maze-save-description">
      <div className="maze-submit-panel" ref={panelRef}>
        <div className="maze-submit-head">
          <h2 id="maze-save-title">Save this maze</h2>
          <button type="button" className="maze-submit-close" onClick={onClose} disabled={busy} aria-label="Close save dialog">&times;</button>
        </div>
        <p className="maze-submit-note" id="maze-save-description">
          We will email a private link that reopens this maze on another device. Nothing is submitted
          for review until you use the Submit button.
        </p>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (event.currentTarget.reportValidity()) onSave(value);
        }}>
          <label>
            Email
            <input ref={emailRef} type="email" autoComplete="email" required value={value} onChange={(event) => setValue(event.target.value)} />
          </label>
          <p className="maze-submit-note">The resume link remains active for 30 days after the last online save.</p>
          <p className="maze-submit-note">Reference underlays are not stored with drafts. Re-upload one after reopening if you still need it while drawing.</p>
          <div className="maze-submit-actions">
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : "Save & email link"}</button>
          </div>
          {status ? <p className="maze-submit-status" role="status" aria-live="polite">{status}</p> : null}
        </form>
      </div>
    </div>
  );
}

function CanvasLayoutPicker({
  value,
  onChange,
  canvasMode,
  onCanvasModeChange,
  canvasTone,
  onCanvasToneChange
}: {
  value: CanvasLayout;
  onChange: (layout: CanvasLayout) => void;
  canvasMode: CanvasMode;
  onCanvasModeChange: (mode: CanvasMode) => void;
  canvasTone: CanvasTone;
  onCanvasToneChange: (tone: CanvasTone) => void;
}) {
  const selectedToneColor = canvasToneColor(canvasTone);
  return (
    <section className="canvas-layout-bar" aria-labelledby="canvas-layout-heading">
      <div className="canvas-layout-primary">
        <div className="canvas-layout-copy">
          <span>Canvas layout</span>
          <p id="canvas-layout-heading">{CANVAS_LAYOUTS[value].description}</p>
        </div>
        <div className="canvas-layout-controls">
          <button
            type="button"
            className={`negative-space-toggle${canvasMode === "negative-space" ? " active" : ""}`}
            aria-pressed={canvasMode === "negative-space"}
            onClick={() => onCanvasModeChange(canvasMode === "negative-space" ? "standard" : "negative-space")}
            style={{ "--canvas-tone-color": selectedToneColor } as CSSProperties}
          >
            <span className="negative-space-toggle-swatch" aria-hidden="true" />
            Negative Space Mode
          </button>
          <div className="canvas-layout-options" role="group" aria-label="Choose canvas layout">
            {CANVAS_LAYOUT_OPTIONS.map((layout) => (
              <button
                key={layout.id}
                type="button"
                className={value === layout.id ? "active" : ""}
                aria-pressed={value === layout.id}
                onClick={() => onChange(layout.id)}
              >
                <span className={`canvas-layout-icon ${layout.id}`} aria-hidden="true" />
                <span>{layout.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="canvas-tone-control">
        <span className="canvas-tone-title" id="canvas-tone-title">Canvas tone</span>
        <div className="canvas-tone-options" role="group" aria-labelledby="canvas-tone-title">
          {CANVAS_TONES.map((tone) => (
            <button
              key={tone.id}
              type="button"
              className={canvasTone === tone.id ? "active" : ""}
              aria-label={tone.label}
              aria-pressed={canvasTone === tone.id}
              title={tone.label}
              onClick={() => onCanvasToneChange(tone.id)}
              style={{ "--canvas-tone-color": tone.color } as CSSProperties}
            >
              <span className="canvas-tone-swatch" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function MobileQuickTools({
  tool,
  onToolChange,
  canvasMode,
  canvasTone,
  snapToEdges,
  onSnapToEdgesChange
}: {
  tool: MazeTool;
  onToolChange: (tool: MazeTool) => void;
  canvasMode: CanvasMode;
  canvasTone: CanvasTone;
  snapToEdges: boolean;
  onSnapToEdgesChange: (enabled: boolean) => void;
}) {
  const eraserWidth = tool.type === "eraser" ? tool.width : 48;
  const defaultInkColor = defaultInkColorForMode(canvasMode, canvasTone);
  return (
    <div className="mobile-quick-tools" role="toolbar" aria-label="Quick maze tools">
      <button
        type="button"
        className={tool.type === "wall" ? "active" : ""}
        aria-pressed={tool.type === "wall"}
        onClick={() => onToolChange(
          tool.type === "wall"
            ? tool
            : { type: "wall", variant: "straight", stroke: defaultInkColor, strokeWidth: 20 }
        )}
      >
        Draw
      </button>
      <button
        type="button"
        className={tool.type === "select" ? "active" : ""}
        aria-pressed={tool.type === "select"}
        onClick={() => onToolChange({ type: "select" })}
      >
        Select
      </button>
      <button
        type="button"
        className={tool.type === "eraser" ? "active" : ""}
        aria-pressed={tool.type === "eraser"}
        onClick={() => onToolChange({ type: "eraser", width: eraserWidth })}
      >
        Erase
      </button>
      <button
        type="button"
        className={snapToEdges ? "active" : ""}
        aria-pressed={snapToEdges}
        onClick={() => onSnapToEdgesChange(!snapToEdges)}
        title="Toggle edge snapping"
      >
        <Magnet size={16} aria-hidden="true" />
        Snap
      </button>
    </div>
  );
}

function CanvasLayoutDialog({
  target,
  onCancel,
  onFit,
  onStartFresh
}: {
  target: CanvasLayout | null;
  onCancel: () => void;
  onFit: () => void;
  onStartFresh: () => void;
}) {
  const fitButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!target) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    fitButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [target, onCancel]);

  if (!target) return null;
  const next = CANVAS_LAYOUTS[target];

  return (
    <div className="maze-submit-overlay" role="dialog" aria-modal="true" aria-labelledby="canvas-layout-dialog-title" aria-describedby="canvas-layout-dialog-note">
      <div className="maze-submit-panel canvas-layout-dialog">
        <div className="maze-submit-head">
          <h2 id="canvas-layout-dialog-title">Change to {next.label}?</h2>
          <button type="button" className="maze-submit-close" onClick={onCancel} aria-label="Keep current canvas layout">
            &times;
          </button>
        </div>
        <p className="maze-submit-note" id="canvas-layout-dialog-note">
          This maze already has marks. Fit preserves the full design and centers it inside the new canvas. Start fresh clears the marks and opens a blank {next.label.toLowerCase()} canvas.
        </p>
        <div className="maze-submit-actions canvas-layout-dialog-actions">
          <button type="button" onClick={onCancel}>Keep current</button>
          <button type="button" className="start-fresh" onClick={onStartFresh}>Start fresh</button>
          <button ref={fitButtonRef} type="button" className="primary" onClick={onFit}>Fit design</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const initialDraftRef = useRef<MazeDraftEnvelope | null>(null);
  if (!initialDraftRef.current) initialDraftRef.current = loadDraft();
  const initialDraft = initialDraftRef.current;
  const [state, setState] = useState<MazeState>(initialDraft.state);
  const [formDraft, setFormDraft] = useState<MazeFormDraft>(initialDraft.form);
  const [undoStack, setUndoStack] = useState<MazeState[]>([]);
  const [redoStack, setRedoStack] = useState<MazeState[]>([]);
  const [selected, setSelected] = useState<Selection>(null);
  const [mazeTool, setMazeTool] = useState<MazeTool>({
    type: "wall",
    variant: "straight",
    stroke: defaultInkColorForMode(initialDraft.state.canvasMode, initialDraft.state.canvasTone),
    strokeWidth: 20
  });
  const [stage, setStage] = useState<Konva.Stage | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [pendingCanvasLayout, setPendingCanvasLayout] = useState<CanvasLayout | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState(
    KIOSK || PREVIEW
      ? "Draft saving is unavailable in preview or kiosk mode."
      : state.mazeWalls.length || state.mazeShapes.length
        ? "Draft restored from this device."
        : "Changes will save on this device."
  );
  const [resumeToken, setResumeToken] = useState(() => captureResumeToken());
  const [resumeReady, setResumeReady] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [reference, setReference] = useState<CanvasReference | null>(null);
  const [referenceStatus, setReferenceStatus] = useState("");
  const [shapeSize, setShapeSize] = useState(DEFAULT_SHAPE_SIZE);
  const [shapeSizeScope, setShapeSizeScope] = useState<ShapeSizeScope>("selected-future");
  const [snapToEdges, setSnapToEdges] = useState(true);

  const stateRef = useRef(state);
  const formDraftRef = useRef(formDraft);
  const clientDraftIdRef = useRef(initialDraft.clientDraftId);
  const serverDraftRef = useRef<ServerDraft | null>(
    initialDraft.serverDraftId
      ? {
          id: initialDraft.serverDraftId,
          revision: initialDraft.serverRevision,
          email: initialDraft.form.email,
          payload: draftPayload(initialDraft.state, initialDraft.form, initialDraft.clientDraftId)
        }
      : null
  );
  const eraseSnapshotRef = useRef<MazeState | null>(null);
  const eraseRecordedRef = useRef(false);
  const referenceLoadIdRef = useRef(0);

  useEffect(() => () => {
    if (reference) URL.revokeObjectURL(reference.src);
  }, [reference]);

  useEffect(() => () => {
    referenceLoadIdRef.current += 1;
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    setMazeTool((current) => sanitizeToolForCanvasMode(current, state.canvasMode, state.canvasTone));
  }, [state.canvasMode, state.canvasTone]);
  useEffect(() => {
    formDraftRef.current = formDraft;
  }, [formDraft]);

  const selectedWall =
    selected?.type === "wall"
      ? state.mazeWalls.find((wall) => wall.instanceId === selected.id) ?? null
      : null;
  const selectedShape =
    selected?.type === "shape"
      ? state.mazeShapes.find((shape) => shape.instanceId === selected.id) ?? null
      : null;

  useEffect(() => {
    if (!selectedShape) return;
    const renderedSize = Math.round(selectedShape.size * selectedShape.scale);
    setShapeSize(Math.max(MIN_SHAPE_SIZE, Math.min(MAX_SHAPE_SIZE, renderedSize)));
  }, [selectedShape?.instanceId, selectedShape?.scale, selectedShape?.size]);

  const commit = useCallback((updater: (current: MazeState) => MazeState) => {
    const current = stateRef.current;
    const next = updater(current);
    if (next === current) return;
    setUndoStack((history) => [...history, clone(current)].slice(-MAX_UNDO_STEPS));
    setRedoStack([]);
    stateRef.current = next;
    setState(next);
  }, []);

  const requestCanvasLayout = (canvasLayout: CanvasLayout) => {
    if (canvasLayout === stateRef.current.canvasLayout) return;
    if (!stateRef.current.mazeWalls.length && !stateRef.current.mazeShapes.length) {
      commit((current) => ({ ...current, canvasLayout }));
      setSelected(null);
      return;
    }
    setPendingCanvasLayout(canvasLayout);
  };

  const requestCanvasMode = (canvasMode: CanvasMode) => {
    commit((current) => switchCanvasMode(current, canvasMode));
  };

  const requestCanvasTone = (canvasTone: CanvasTone) => {
    commit((current) => switchCanvasTone(current, canvasTone));
  };

  const fitPendingCanvasLayout = () => {
    if (!pendingCanvasLayout) return;
    const nextLayout = pendingCanvasLayout;
    setPendingCanvasLayout(null);
    commit((current) => fitMazeToLayout(current, nextLayout));
    setSelected(null);
  };

  const startFreshCanvasLayout = () => {
    if (!pendingCanvasLayout) return;
    const nextLayout = pendingCanvasLayout;
    setPendingCanvasLayout(null);
    commit((current) => emptyState(nextLayout, current.canvasMode, current.canvasTone));
    setSelected(null);
  };

  const undo = () => {
    if (undoStack.length === 0) return;
    const previous = clone(undoStack[undoStack.length - 1]);
    setRedoStack((redo) => [...redo, clone(stateRef.current)].slice(-MAX_UNDO_STEPS));
    setUndoStack(undoStack.slice(0, -1));
    stateRef.current = previous;
    setState(previous);
    setSelected(null);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const next = clone(redoStack[redoStack.length - 1]);
    setUndoStack((history) => [...history, clone(stateRef.current)].slice(-MAX_UNDO_STEPS));
    setRedoStack(redoStack.slice(0, -1));
    stateRef.current = next;
    setState(next);
    setSelected(null);
  };

  const setWalls = (mazeWalls: MazeWall[]) =>
    commit((current) => ({ ...current, mazeWalls: [...mazeWalls].sort(byZ) }));
  const setShapes = (mazeShapes: MazeShape[]) =>
    commit((current) => ({ ...current, mazeShapes: [...mazeShapes].sort(byZ) }));

  const addMazeWall = (wall: MazeWall) => setWalls([...state.mazeWalls, wall]);
  const updateMazeWall = (next: MazeWall) =>
    setWalls(state.mazeWalls.map((wall) => (wall.instanceId === next.instanceId ? next : wall)));
  const deleteMazeWall = (id: string) => {
    setWalls(state.mazeWalls.filter((wall) => wall.instanceId !== id));
    if (selected?.type === "wall" && selected.id === id) setSelected(null);
  };

  const addMazeShape = (shape: MazeShape) => setShapes([...state.mazeShapes, shape]);
  const updateMazeShape = (next: MazeShape) =>
    setShapes(state.mazeShapes.map((shape) => (shape.instanceId === next.instanceId ? next : shape)));
  const deleteMazeShape = (id: string) => {
    setShapes(state.mazeShapes.filter((shape) => shape.instanceId !== id));
    if (selected?.type === "shape" && selected.id === id) setSelected(null);
  };

  const beginErase = () => {
    eraseSnapshotRef.current = clone(stateRef.current);
    eraseRecordedRef.current = false;
  };
  const endErase = () => {
    eraseSnapshotRef.current = null;
    eraseRecordedRef.current = false;
  };
  const eraseAt = (point: { x: number; y: number }, radius: number) => {
    let selectionSurvives = true;
    setState((current) => {
      const nextWalls = current.mazeWalls.flatMap((wall) => splitWallByEraser(wall, point, radius));
      const nextShapes = current.mazeShapes.filter((shape) => !shapeTouchedByEraser(shape, point, radius));
      const wallsChanged =
        nextWalls.length !== current.mazeWalls.length ||
        nextWalls.some((wall, index) => wall !== current.mazeWalls[index]);
      const shapesChanged = nextShapes.length !== current.mazeShapes.length;
      if (!wallsChanged && !shapesChanged) return current;

      if (selected?.type === "wall") {
        selectionSurvives = nextWalls.some((wall) => wall.instanceId === selected.id);
      } else if (selected?.type === "shape") {
        selectionSurvives = nextShapes.some((shape) => shape.instanceId === selected.id);
      }

      if (eraseSnapshotRef.current && !eraseRecordedRef.current) {
        setUndoStack((history) =>
          [...history, clone(eraseSnapshotRef.current as MazeState)].slice(-MAX_UNDO_STEPS)
        );
        setRedoStack([]);
        eraseRecordedRef.current = true;
      }

      const next = {
        canvasLayout: current.canvasLayout,
        canvasMode: current.canvasMode,
        canvasTone: current.canvasTone,
        mazeWalls: nextWalls.sort(byZ),
        mazeShapes: nextShapes.sort(byZ)
      };
      stateRef.current = next;
      return next;
    });
    if (!selectionSurvives) setSelected(null);
  };

  const duplicateSelected = () => {
    if (selectedWall) {
      const copy: MazeWall = {
        ...selectedWall,
        instanceId: crypto.randomUUID(),
        points: selectedWall.points.map((point) => point + 34),
        x: selectedWall.x === undefined ? undefined : selectedWall.x + 34,
        y: selectedWall.y === undefined ? undefined : selectedWall.y + 34,
        zIndex: nextZIndex(state)
      };
      setWalls([...state.mazeWalls, copy]);
      setSelected({ type: "wall", id: copy.instanceId });
      return;
    }
    if (selectedShape) {
      const copy: MazeShape = {
        ...selectedShape,
        instanceId: crypto.randomUUID(),
        x: selectedShape.x + 38,
        y: selectedShape.y + 38,
        zIndex: nextZIndex(state)
      };
      setShapes([...state.mazeShapes, copy]);
      setSelected({ type: "shape", id: copy.instanceId });
    }
  };

  const deleteSelected = () => {
    if (selected?.type === "wall") deleteMazeWall(selected.id);
    else if (selected?.type === "shape") deleteMazeShape(selected.id);
  };

  const resizeShapes = (size: number) => {
    const nextSize = Math.max(MIN_SHAPE_SIZE, Math.min(MAX_SHAPE_SIZE, Math.round(size)));
    setShapeSize(nextSize);
    setMazeTool((current) => current.type === "shape" ? { ...current, size: nextSize } : current);

    if (shapeSizeScope === "all" && state.mazeShapes.length) {
      setShapes(state.mazeShapes.map((shape) => ({ ...shape, size: nextSize, scale: 1 })));
      return;
    }
    if (selectedShape) {
      setShapes(state.mazeShapes.map((shape) =>
        shape.instanceId === selectedShape.instanceId
          ? { ...shape, size: nextSize, scale: 1 }
          : shape
      ));
    }
  };

  const uploadReference = (file: File) => {
    const loadId = referenceLoadIdRef.current + 1;
    referenceLoadIdRef.current = loadId;
    setReferenceStatus("");
    const supportedType = REFERENCE_TYPES.has(file.type.toLowerCase());
    const supportedExtension = /\.(png|jpe?g|webp)$/i.test(file.name);
    if (!supportedType && !supportedExtension) {
      setReferenceStatus("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > REFERENCE_MAX_BYTES) {
      setReferenceStatus("Reference images must be 15 MB or smaller.");
      return;
    }

    const src = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      if (referenceLoadIdRef.current !== loadId) {
        URL.revokeObjectURL(src);
        return;
      }
      if (!image.naturalWidth || !image.naturalHeight) {
        URL.revokeObjectURL(src);
        setReferenceStatus("That image could not be read.");
        return;
      }
      setReference({
        name: file.name,
        src,
        width: image.naturalWidth,
        height: image.naturalHeight
      });
      setReferenceStatus("Reference ready. Draw maze marks over it.");
    };
    image.onerror = () => {
      URL.revokeObjectURL(src);
      if (referenceLoadIdRef.current === loadId) {
        setReferenceStatus("That image could not be read.");
      }
    };
    image.src = src;
  };

  const removeReference = () => {
    referenceLoadIdRef.current += 1;
    setReference(null);
    setReferenceStatus("Reference removed.");
  };

  const persistLocal = (payload = draftPayload(stateRef.current, formDraftRef.current, clientDraftIdRef.current)) => {
    if (KIOSK || PREVIEW) return;
    const server = serverDraftRef.current;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      state: {
        canvasLayout: payload.canvasLayout,
        canvasMode: payload.canvasMode,
        canvasTone: payload.canvasTone,
        mazeWalls: payload.mazeWalls,
        mazeShapes: payload.mazeShapes
      },
      form: payloadToForm(payload),
      clientDraftId: payload.clientDraftId,
      serverDraftId: server?.id || "",
      serverRevision: server?.revision || 0
    } satisfies MazeDraftEnvelope));
    localStorage.removeItem(PREVIOUS_STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  };

  const resetMaze = () => {
    if (!KIOSK && !PREVIEW) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(PREVIOUS_STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    commit((current) => emptyState(current.canvasLayout, current.canvasMode, current.canvasTone));
    setSelected(null);
    removeReference();
  };

  const exportImage = () => {
    const url = captureMazeImage(stage);
    if (!url) return;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "art-pill-maze.png";
    anchor.click();
  };

  const exportJson = () => {
    downloadFile("art-pill-maze.json", JSON.stringify(state, null, 2), "application/json");
  };

  useEffect(() => {
    if (KIOSK || PREVIEW || (resumeToken && !resumeReady)) return;
    setSaveStatus("Saving…");
    const timer = window.setTimeout(async () => {
      const payload = draftPayload(stateRef.current, formDraftRef.current, clientDraftIdRef.current);
      try {
        persistLocal(payload);
      } catch {
        setSaveStatus("This browser could not save the maze.");
        return;
      }
      const server = serverDraftRef.current;
      if (!resumeToken || !server) {
        setSaveStatus("Saved on this device.");
        return;
      }
      try {
        const response = await fetch("/api/build-drafts/current", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${resumeToken}`
          },
          body: JSON.stringify({ revision: server.revision, payload })
        });
        const result = await response.json().catch(() => ({})) as { error?: string; draft?: ServerDraft };
        if (!response.ok) {
          if (response.status === 409 && result.draft) serverDraftRef.current = result.draft;
          throw new Error(result.error || "Online save failed.");
        }
        if (result.draft) serverDraftRef.current = result.draft;
        persistLocal(payload);
        setSaveStatus("Saved online.");
      } catch {
        setSaveStatus("Saved on this device — online save pending.");
      }
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [state, formDraft, resumeToken, resumeReady]);

  useEffect(() => {
    if (KIOSK || PREVIEW || !resumeToken) {
      setResumeReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/build-drafts/current", {
          headers: { authorization: `Bearer ${resumeToken}` }
        });
        const result = await response.json().catch(() => ({})) as { error?: string; draft?: ServerDraft };
        if (!response.ok || !result.draft) throw new Error(result.error || "Unable to open this Maze draft.");
        const remote = result.draft;
        const local = initialDraftRef.current;
        const hasLocal = Boolean(local && (local.state.mazeWalls.length || local.state.mazeShapes.length));
        const unrelated = Boolean(hasLocal && (!local?.serverDraftId || local.serverDraftId !== remote.id));
        const openRemote = !unrelated || window.confirm(
          "A different maze is saved on this device. Select OK to open the emailed draft, or Cancel to keep the device draft."
        );
        if (cancelled) return;
        if (!openRemote) {
          clearResumeToken();
          setResumeToken("");
          serverDraftRef.current = null;
          setSaveStatus("Kept the maze saved on this device.");
          setResumeReady(true);
          return;
        }
        const payload = remote.payload;
        const restored = normalizeMazeState(payload, "wide");
        stateRef.current = restored;
        setState(restored);
        const nextForm = payloadToForm(payload);
        formDraftRef.current = nextForm;
        setFormDraft(nextForm);
        clientDraftIdRef.current = payload.clientDraftId || clientDraftIdRef.current;
        serverDraftRef.current = remote;
        setOwnerEmail(remote.email || nextForm.email);
        setSaveStatus("Emailed draft restored. Saved online.");
        setResumeReady(true);
      } catch (error) {
        if (!cancelled) {
          setSaveStatus(error instanceof Error ? error.message : "The emailed draft could not be opened.");
          setResumeReady(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [resumeToken]);

  const emailMazeDraft = async (email: string) => {
    if (!state.mazeWalls.length && !state.mazeShapes.length) {
      setSaveStatus("Add at least one Maze mark before emailing this draft.");
      return;
    }
    setSaveBusy(true);
    setSaveStatus("Saving this maze and preparing your link…");
    try {
      const nextForm = { ...formDraftRef.current, email };
      formDraftRef.current = nextForm;
      setFormDraft(nextForm);
      const payload = draftPayload(stateRef.current, nextForm, clientDraftIdRef.current);
      let response: Response;
      if (resumeToken && serverDraftRef.current) {
        response = await fetch("/api/build-drafts/current/email", {
          method: "POST",
          headers: { authorization: `Bearer ${resumeToken}` }
        });
      } else {
        response = await fetch("/api/build-drafts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "maze_design", email, payload })
        });
      }
      const result = await response.json().catch(() => ({})) as {
        error?: string;
        emailSent?: boolean;
        deliveryError?: string;
        resumeToken?: string;
        draft?: ServerDraft;
      };
      if (!response.ok) throw new Error(result.error || "The resume email could not be sent.");
      if (result.resumeToken) {
        try { sessionStorage.setItem(TOKEN_STORAGE_KEY, result.resumeToken); } catch { /* storage can be unavailable */ }
        setResumeToken(result.resumeToken);
      }
      if (result.draft) serverDraftRef.current = result.draft;
      setOwnerEmail(email);
      setResumeReady(true);
      persistLocal(payload);
      if (result.emailSent === false) {
        setSaveStatus(`Saved online, but the email was not sent. ${result.deliveryError || "Try again."}`);
      } else {
        setSaveStatus("Saved online. Resume link emailed.");
        window.setTimeout(() => setSaveDialogOpen(false), 900);
      }
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : "The resume email could not be sent.");
    } finally {
      setSaveBusy(false);
    }
  };

  const completeDraft = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(PREVIOUS_STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch { /* storage can be unavailable */ }
    clearResumeToken();
    serverDraftRef.current = null;
    setOwnerEmail("");
  };

  // Kiosk: reset to a blank maze after a stretch of inactivity, so the terminal
  // is fresh for the next person.
  useEffect(() => {
    if (!KIOSK) return;
    let idle: number;
    const reset = () => {
      const blank = emptyState();
      stateRef.current = blank;
      setState(blank);
      setSelected(null);
      setUndoStack([]);
      setRedoStack([]);
      setSubmitOpen(false);
      setSaveDialogOpen(false);
      setFormDraft(emptyForm());
      removeReference();
    };
    const bump = () => {
      window.clearTimeout(idle);
      idle = window.setTimeout(reset, KIOSK_IDLE_MS);
    };
    const events = ["click", "keydown", "touchstart", "mousemove"];
    events.forEach((event) => window.addEventListener(event, bump, { passive: true }));
    bump();
    return () => {
      window.clearTimeout(idle);
      events.forEach((event) => window.removeEventListener(event, bump));
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if (meta && event.key.toLowerCase() === "d" && selected) {
        event.preventDefault();
        duplicateSelected();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selected) {
        event.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <main className={`app tattoo-app${KIOSK ? " terminal" : ""}`}>
      <header className="topbar">
        <div>
          <span className="eyebrow">Art.Pill Tattoo House</span>
          <h1>Maze Studio</h1>
        </div>
        <div className="mode-controls" aria-label="Maze controls">
          {!KIOSK ? (
            <a className="back-to-build" href="/tattoos/build/">
              <ArrowLeft size={18} />
              Back to Build
            </a>
          ) : null}
          {!KIOSK ? <a className="back-to-build" href="/archive/maze/">Maze Archive</a> : null}
          <button type="button" onClick={undo} disabled={undoStack.length === 0} title="Undo">
            <Undo2 size={18} />
            Undo
          </button>
          <button type="button" onClick={redo} disabled={redoStack.length === 0} title="Redo">
            <Redo2 size={18} />
            Redo
          </button>
          <button type="button" className="submit-maze" onClick={() => setSubmitOpen(true)} title="Submit this maze for review">
            <Send size={18} />
            Submit
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="palette" aria-label="Maze design palette">
          <MazeTools
            tool={mazeTool}
            onToolChange={setMazeTool}
            canvasMode={state.canvasMode}
            canvasTone={state.canvasTone}
            referenceName={reference?.name || ""}
            referenceStatus={referenceStatus}
            onReferenceUpload={uploadReference}
            onReferenceRemove={removeReference}
            shapeSize={shapeSize}
            shapeSizeScope={shapeSizeScope}
            hasSelectedShape={Boolean(selectedShape)}
            shapeCount={state.mazeShapes.length}
            snapToEdges={snapToEdges}
            onShapeSizeChange={resizeShapes}
            onShapeSizeScopeChange={setShapeSizeScope}
            onSnapToEdgesChange={setSnapToEdges}
          />
        </aside>
        <div className="canvas-workspace">
          <CanvasLayoutPicker
            value={state.canvasLayout}
            onChange={requestCanvasLayout}
            canvasMode={state.canvasMode}
            onCanvasModeChange={requestCanvasMode}
            canvasTone={state.canvasTone}
            onCanvasToneChange={requestCanvasTone}
          />
          <MobileQuickTools
            tool={mazeTool}
            onToolChange={setMazeTool}
            canvasMode={state.canvasMode}
            canvasTone={state.canvasTone}
            snapToEdges={snapToEdges}
            onSnapToEdgesChange={setSnapToEdges}
          />
          <ConstructCanvas
            items={[]}
            canvasLayout={state.canvasLayout}
            canvasMode={state.canvasMode}
            canvasTone={state.canvasTone}
            snapToEdges={snapToEdges}
            reference={reference}
            mazeWalls={state.mazeWalls}
            mazeShapes={state.mazeShapes}
            selected={selected}
            workspaceMode="maze"
            mazeTool={mazeTool}
            onSelect={setSelected}
            onChange={() => undefined}
            onMazeWallAdd={addMazeWall}
            onMazeWallChange={updateMazeWall}
            onMazeWallDelete={deleteMazeWall}
            onMazeEraseStart={beginErase}
            onMazeEraseAt={eraseAt}
            onMazeEraseEnd={endErase}
            onMazeWallPreview={() => undefined}
            onMazeShapeAdd={addMazeShape}
            onMazeShapeChange={updateMazeShape}
            onMazeShapeDelete={deleteMazeShape}
            onStageReady={setStage}
          />
        </div>
        <Inspector
          workspaceTab="maze"
          selectedSymbol={null}
          selectedWall={selectedWall}
          selectedShape={selectedShape}
          lines={[]}
          onDuplicate={duplicateSelected}
          onDelete={deleteSelected}
          onReset={resetMaze}
          onSave={() => {
            persistLocal();
            setSaveStatus(resumeToken ? "Saved on this device — online copy will sync automatically." : "Saved on this device.");
          }}
          onEmailSave={() => setSaveDialogOpen(true)}
          saveStatus={saveStatus}
          emailSaveDisabled={KIOSK || PREVIEW || (!state.mazeWalls.length && !state.mazeShapes.length)}
          onExportJson={exportJson}
          onExportImage={exportImage}
          onExportReading={() => downloadFile("maze-notes.txt", "Maze Studio export uses PNG and project JSON.", "text/plain")}
        />
      </section>

      <SubmitDialog
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        capturePng={(variant) => captureMazeImage(stage, variant)}
        canvasMode={state.canvasMode}
        getJson={() => JSON.stringify(state)}
        isEmpty={state.mazeWalls.length === 0 && state.mazeShapes.length === 0}
        formDraft={formDraft}
        onFormDraftChange={setFormDraft}
        resumeToken={resumeToken}
        ownerEmail={ownerEmail}
        onSubmitted={completeDraft}
      />
      <SaveEmailDialog
        open={saveDialogOpen}
        email={formDraft.email}
        busy={saveBusy}
        status={saveStatus}
        onClose={() => setSaveDialogOpen(false)}
        onSave={emailMazeDraft}
      />
      <CanvasLayoutDialog
        target={pendingCanvasLayout}
        onCancel={() => setPendingCanvasLayout(null)}
        onFit={fitPendingCanvasLayout}
        onStartFresh={startFreshCanvasLayout}
      />
      {KIOSK ? (
        <button type="button" className="kiosk-start-over" onClick={resetMaze}>
          Start over
        </button>
      ) : null}
    </main>
  );
}
