import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type Konva from "konva";
import { Redo2, Send, Undo2 } from "lucide-react";
import { ConstructCanvas } from "./components/ConstructCanvas";
import { Inspector } from "./components/Inspector";
import { MazeTools } from "./components/MazeTools";
import { shapeTouchedByEraser, splitWallByEraser } from "./lib/maze";
import type { MazeShape, MazeTool, MazeWall, Selection } from "./types";
import "./maze-submit.css";

const STORAGE_KEY = "art-pill-maze-design";
const MAX_UNDO_STEPS = 60;
const AUTOSAVE_DELAY_MS = 600;
const KIOSK = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("kiosk");
const KIOSK_IDLE_MS = 150000;

type MazeState = {
  mazeWalls: MazeWall[];
  mazeShapes: MazeShape[];
};

function emptyState(): MazeState {
  return { mazeWalls: [], mazeShapes: [] };
}

function clone(state: MazeState): MazeState {
  return JSON.parse(JSON.stringify(state)) as MazeState;
}

function byZ<T extends { zIndex: number }>(a: T, b: T) {
  return a.zIndex - b.zIndex;
}

function loadState(): MazeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<MazeState>;
    return {
      mazeWalls: Array.isArray(parsed.mazeWalls) ? parsed.mazeWalls : [],
      mazeShapes: Array.isArray(parsed.mazeShapes) ? parsed.mazeShapes : []
    };
  } catch {
    return emptyState();
  }
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

// Submit a finished maze into the same review -> booking pipeline as a brief.
// Captures the maze as PNG + JSON, collects contact details and an explanation,
// and posts as a `maze_design` submission.
function SubmitDialog({
  open,
  onClose,
  capturePng,
  getJson,
  isEmpty
}: {
  open: boolean;
  onClose: () => void;
  capturePng: () => string | null;
  getJson: () => string;
  isEmpty: boolean;
}) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    setBusy(true);
    setStatus("Capturing your maze for review.");

    try {
      const fd = new FormData(form);
      fd.set("type", "maze_design");
      fd.set("source_path", "/tattoos/build/maze/");
      fd.set("subject", "New Art.Pill Build a Maze submission");
      fd.set("review_consent", "yes");

      const png = capturePng();
      if (png) fd.set("maze_image", dataUrlToBlob(png), "maze.png");
      fd.set("maze_json_file", new Blob([getJson()], { type: "application/json" }), "maze.json");

      const res = await fetch("/api/submissions", { method: "POST", body: fd });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "Submission failed.");
      window.location.href = "/tattoos/submission-received/?type=maze";
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Submission failed. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div className="maze-submit-overlay" role="dialog" aria-modal="true" aria-label="Submit your maze">
      <div className="maze-submit-panel">
        <div className="maze-submit-head">
          <h2>Submit your maze</h2>
          <button type="button" className="maze-submit-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <p className="maze-submit-note">
          Your maze is captured as an image and sent for review. If it fits, a private booking link
          follows. You create the final tattoo from this design.
        </p>
        {isEmpty ? (
          <p className="maze-submit-warn">Draw at least one wall or shape before submitting.</p>
        ) : null}
        <form onSubmit={handleSubmit}>
          <div className="maze-submit-grid">
            <label>First name<input name="firstName" autoComplete="given-name" required /></label>
            <label>Last name<input name="lastName" autoComplete="family-name" required /></label>
            <label>Email<input name="email" type="email" autoComplete="email" required /></label>
            <label>Phone (optional)<input name="phone" autoComplete="tel" /></label>
            <label>Placement (optional)<input name="placement" placeholder="e.g. forearm, spine" /></label>
            <label>Approx. scale (optional)<input name="scale" placeholder="e.g. palm-size" /></label>
          </div>
          <label className="maze-submit-full">
            What does this maze carry?
            <textarea name="maze_explanation" rows={4} required placeholder="Explain the meaning, the path, what it should hold." />
          </label>
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
          {status ? <p className="maze-submit-status">{status}</p> : null}
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<MazeState>(() => (KIOSK ? emptyState() : loadState()));
  const [undoStack, setUndoStack] = useState<MazeState[]>([]);
  const [redoStack, setRedoStack] = useState<MazeState[]>([]);
  const [selected, setSelected] = useState<Selection>(null);
  const [mazeTool, setMazeTool] = useState<MazeTool>({
    type: "wall",
    variant: "straight",
    stroke: "#151413",
    strokeWidth: 20
  });
  const [stage, setStage] = useState<Konva.Stage | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);

  const stateRef = useRef(state);
  const eraseSnapshotRef = useRef<MazeState | null>(null);
  const eraseRecordedRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const selectedWall =
    selected?.type === "wall"
      ? state.mazeWalls.find((wall) => wall.instanceId === selected.id) ?? null
      : null;
  const selectedShape =
    selected?.type === "shape"
      ? state.mazeShapes.find((shape) => shape.instanceId === selected.id) ?? null
      : null;

  const commit = useCallback((updater: (current: MazeState) => MazeState) => {
    const current = stateRef.current;
    const next = updater(current);
    if (next === current) return;
    setUndoStack((history) => [...history, clone(current)].slice(-MAX_UNDO_STEPS));
    setRedoStack([]);
    stateRef.current = next;
    setState(next);
  }, []);

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

  const resetMaze = () => {
    localStorage.removeItem(STORAGE_KEY);
    commit(() => emptyState());
    setSelected(null);
  };

  const exportImage = () => {
    if (!stage) return;
    const stageScale = stage.scaleX() || 1;
    const url = stage.toDataURL({ pixelRatio: 2 / stageScale });
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "art-pill-maze.png";
    anchor.click();
  };

  const exportJson = () => {
    downloadFile("art-pill-maze.json", JSON.stringify(state, null, 2), "application/json");
  };

  useEffect(() => {
    if (KIOSK) return; // a studio terminal must not carry one client's maze to the next
    const timer = window.setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

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
          <MazeTools tool={mazeTool} onToolChange={setMazeTool} />
        </aside>
        <ConstructCanvas
          items={[]}
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
        <Inspector
          workspaceTab="maze"
          selectedSymbol={null}
          selectedWall={selectedWall}
          selectedShape={selectedShape}
          lines={[]}
          onDuplicate={duplicateSelected}
          onDelete={deleteSelected}
          onReset={resetMaze}
          onSave={() => localStorage.setItem(STORAGE_KEY, JSON.stringify(state))}
          onExportJson={exportJson}
          onExportImage={exportImage}
          onExportReading={() => downloadFile("maze-notes.txt", "Maze Studio export uses PNG and project JSON.", "text/plain")}
        />
      </section>

      <SubmitDialog
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        capturePng={() => (stage ? stage.toDataURL({ pixelRatio: 2 / (stage.scaleX() || 1) }) : null)}
        getJson={() => JSON.stringify(state)}
        isEmpty={state.mazeWalls.length === 0 && state.mazeShapes.length === 0}
      />
      {KIOSK ? (
        <button type="button" className="kiosk-start-over" onClick={resetMaze}>
          Start over
        </button>
      ) : null}
    </main>
  );
}
