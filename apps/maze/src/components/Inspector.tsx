import { Copy, Download, FileText, Mail, RotateCcw, Save, Trash2 } from "lucide-react";
import { symbolLibrary } from "../data/symbols";
import type { CanvasItem, InterpretationLine, MazeShape, MazeWall } from "../types";

type InspectorProps = {
  workspaceTab: "construct" | "maze";
  selectedSymbol: CanvasItem | null;
  selectedWall: MazeWall | null;
  selectedShape: MazeShape | null;
  lines: InterpretationLine[];
  onDuplicate: () => void;
  onDelete: () => void;
  onReset: () => void;
  onSave: () => void;
  onEmailSave: () => void;
  saveStatus: string;
  emailSaveDisabled: boolean;
  onExportJson: () => void;
  onExportImage: () => void;
  onExportReading: () => void;
};

export function Inspector({
  workspaceTab,
  selectedSymbol,
  selectedWall,
  selectedShape,
  lines,
  onDuplicate,
  onDelete,
  onReset,
  onSave,
  onEmailSave,
  saveStatus,
  emailSaveDisabled,
  onExportJson,
  onExportImage,
  onExportReading
}: InspectorProps) {
  const symbol = selectedSymbol
    ? symbolLibrary.find((entry) => entry.id === selectedSymbol.symbolId)
    : null;
  const hasSelection = Boolean(selectedSymbol || selectedWall || selectedShape);

  return (
    <aside className="inspector" aria-label="Construct interpretation">
      <div className="panel-heading">
        <p>Reading</p>
        <span>live</span>
      </div>

      <div className="selected-card">
        {symbol && selectedSymbol ? (
          <>
            <span>{symbol.category}</span>
            <h2>{symbol.name}</h2>
            <p>{symbol.vocabulary}</p>
            <dl>
              <div>
                <dt>Rotation</dt>
                <dd>{Math.round(selectedSymbol.rotation)} deg</dd>
              </div>
              <div>
                <dt>Scale</dt>
                <dd>{selectedSymbol.scale.toFixed(2)}x</dd>
              </div>
            </dl>
            <div className="button-row">
              <button type="button" onClick={onDuplicate} title="Duplicate selected symbol">
                <Copy size={18} />
              </button>
              <button type="button" onClick={onDelete} title="Delete selected symbol">
                <Trash2 size={18} />
              </button>
            </div>
          </>
        ) : selectedWall ? (
          <>
            <span>Maze wall</span>
            <h2>Drawn wall segment</h2>
            <p>Use wall segments to build the maze outline and interior paths.</p>
            <dl>
              <div>
                <dt>Width</dt>
                <dd>{Math.round(selectedWall.strokeWidth)} px</dd>
              </div>
              <div>
                <dt>Ink</dt>
                <dd>{selectedWall.stroke}</dd>
              </div>
            </dl>
            <div className="button-row">
              <button type="button" onClick={onDuplicate} title="Duplicate selected wall">
                <Copy size={18} />
              </button>
              <button type="button" onClick={onDelete} title="Delete selected wall">
                <Trash2 size={18} />
              </button>
            </div>
          </>
        ) : selectedShape ? (
          <>
            <span>Geometric marker</span>
            <h2>{selectedShape.kind}</h2>
            <p>{selectedShape.filled ? "Solid" : "Outlined"} placement mark for the maze design.</p>
            <dl>
              <div>
                <dt>Rotation</dt>
                <dd>{Math.round(selectedShape.rotation)} deg</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{Math.round(selectedShape.size * selectedShape.scale)} px</dd>
              </div>
              <div>
                <dt>Scale</dt>
                <dd>{selectedShape.scale.toFixed(2)}x from {Math.round(selectedShape.size)} px</dd>
              </div>
            </dl>
            <div className="button-row">
              <button type="button" onClick={onDuplicate} title="Duplicate selected shape">
                <Copy size={18} />
              </button>
              <button type="button" onClick={onDelete} title="Delete selected shape">
                <Trash2 size={18} />
              </button>
            </div>
          </>
        ) : (
          <>
            <span>{workspaceTab === "maze" ? "Maze Designer" : "Composition"}</span>
            <h2>No mark selected</h2>
            <p>
              {workspaceTab === "maze"
                ? "Draw maze walls or place a geometric marker, then select it to move or transform it."
                : "Select a mark to inspect or transform it. The reading updates as symbols move."}
            </p>
          </>
        )}
      </div>

      {workspaceTab === "construct" ? (
        <div className="reading-list">
          {lines.map((line) => (
            <article className={`reading-line ${line.tone}`} key={line.id}>
              <h3>{line.title}</h3>
              <p>{line.body}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="reading-list">
          <article className="reading-line composition">
            <h3>Maze composition</h3>
            <p>
              Wall paths create the tattoo structure; solid and outlined geometry can be used as
              checkpoints, signals, or accent marks.
            </p>
          </article>
          {hasSelection ? (
            <article className="reading-line relationship">
              <h3>Selected mark</h3>
              <p>
                Drag to position it, use the corner handles to resize, or press and hold a drawn
                wall to perfect it.
              </p>
            </article>
          ) : null}
        </div>
      )}

      <div className="action-grid">
        <button type="button" onClick={onSave}>
          <Save size={18} />
          Save
        </button>
        <button type="button" onClick={onEmailSave} disabled={emailSaveDisabled}>
          <Mail size={18} />
          Save &amp; email
        </button>
        <button type="button" onClick={onExportImage}>
          <Download size={18} />
          PNG
        </button>
        <button type="button" onClick={onExportJson}>
          <FileText size={18} />
          JSON
        </button>
        <button type="button" onClick={onExportReading}>
          <FileText size={18} />
          Reading
        </button>
        <button type="button" className="reset-button" onClick={onReset}>
          <RotateCcw size={18} />
          Reset
        </button>
      </div>
      <p className="maze-draft-status" role="status" aria-live="polite">{saveStatus}</p>
    </aside>
  );
}
