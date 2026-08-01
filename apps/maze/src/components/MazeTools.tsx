import {
  Circle,
  Eraser,
  Hexagon,
  ImageUp,
  MousePointer2,
  Pentagon,
  PenLine,
  Radius,
  Square,
  Triangle,
  X
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useRef } from "react";
import type { MazeShapeKind, MazeTool } from "../types";

type WallPreset = Extract<MazeTool, { type: "wallPreset" }>["preset"];

// Each preview is drawn from the same geometry as the placed stamp (see
// wallStampPoints in lib/maze) so the button shows exactly what you'll stamp.
const wallPresetOptions: Array<{ preset: WallPreset; label: string; glyph: ReactNode }> = [
  { preset: "culdesac", label: "ring", glyph: <circle cx="12" cy="12" r="8" /> },
  {
    preset: "pocket",
    label: "cul-de-sac",
    glyph: (
      <>
        <path d="M8.5 20 V13" />
        <path d="M15.5 20 V13" />
        <path d="M8.5 13 A5 5 0 1 1 15.5 13" />
      </>
    )
  },
  { preset: "corner", label: "corner", glyph: <path d="M5 4 V20 H20" /> },
  { preset: "tee", label: "T-junction", glyph: <path d="M4 5 H20 M12 5 V20" /> },
  { preset: "cross", label: "crossroads", glyph: <path d="M12 4 V20 M4 12 H20" /> },
  { preset: "hook", label: "dead-end", glyph: <path d="M5 4 V20 H19 V4" /> },
  { preset: "square", label: "square", glyph: <path d="M4 4 H20 V20 H4 Z" /> },
  { preset: "triangle", label: "triangle", glyph: <path d="M12 4 L20 19 H4 Z" /> },
  {
    preset: "pentagon",
    label: "pentagon",
    glyph: <path d="M12 4 L19.6 9.5 L16.7 18.5 L7.3 18.5 L4.4 9.5 Z" />
  },
  {
    preset: "hexagon",
    label: "hexagon",
    glyph: <path d="M12 4 L18.9 8 L18.9 16 L12 20 L5.1 16 L5.1 8 Z" />
  }
];

function StampGlyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width={19}
      height={19}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const shapeOptions: Array<{
  kind: MazeShapeKind;
  label: string;
  Icon: typeof Circle;
}> = [
  { kind: "circle", label: "Circle", Icon: Circle },
  { kind: "square", label: "Square", Icon: Square },
  { kind: "triangle", label: "Triangle", Icon: Triangle },
  { kind: "pentagon", label: "Pentagon", Icon: Pentagon },
  { kind: "hexagon", label: "Hexagon", Icon: Hexagon }
];

const inkOptions = ["#151413", "#b51f29", "#1f7c8c", "#d66a1f", "#d9a21b", "#2d9b74"];

type MazeToolsProps = {
  tool: MazeTool;
  onToolChange: (tool: MazeTool) => void;
  referenceName: string;
  referenceStatus: string;
  onReferenceUpload: (file: File) => void;
  onReferenceRemove: () => void;
};

export function MazeTools({
  tool,
  onToolChange,
  referenceName,
  referenceStatus,
  onReferenceUpload,
  onReferenceRemove
}: MazeToolsProps) {
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const shapeTool = tool.type === "shape" ? tool : null;
  const wallTool = tool.type === "wall" ? tool : null;
  const presetTool = tool.type === "wallPreset" ? tool : null;
  const eraserTool = tool.type === "eraser" ? tool : null;
  const activeColor = shapeTool?.fill ?? wallTool?.stroke ?? presetTool?.stroke ?? "#151413";
  const activeWallWidth = wallTool?.strokeWidth ?? presetTool?.strokeWidth ?? 20;
  const activeEraserWidth = eraserTool?.width ?? 48;

  const setShapeKind = (kind: MazeShapeKind) => {
    onToolChange({
      type: "shape",
      kind,
      stroke: "#151413",
      fill: activeColor,
      filled: shapeTool?.filled ?? true,
      size: shapeTool?.size ?? 54
    });
  };

  return (
    <section className="maze-tools" aria-label="Maze design tools">
      <div className="panel-heading">
        <p>Maze Builder</p>
        <span>draw + place</span>
      </div>

      <div className="upload-panel reference-upload-panel">
        <div className="reference-upload-copy">
          <strong>Reference underlay</strong>
          <span>Temporary guide only. It will not be saved or exported.</span>
        </div>
        <input
          ref={referenceInputRef}
          className="hidden-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onReferenceUpload(file);
          }}
        />
        <div className="upload-actions">
          <button type="button" onClick={() => referenceInputRef.current?.click()}>
            <ImageUp size={18} />
            {referenceName ? "Replace" : "Upload reference"}
          </button>
          <button type="button" onClick={onReferenceRemove} disabled={!referenceName}>
            <X size={18} />
            Remove
          </button>
        </div>
        {referenceName ? <p className="reference-file-name" title={referenceName}>{referenceName}</p> : null}
        {referenceStatus ? <p className="reference-upload-status" role="status" aria-live="polite">{referenceStatus}</p> : null}
      </div>

      <div className="tool-row" role="group" aria-label="Maze drawing mode">
        <button
          type="button"
          className={tool.type === "select" ? "active" : ""}
          onClick={() => onToolChange({ type: "select" })}
          title="Select and move marks"
        >
          <MousePointer2 size={18} />
        </button>
        <button
          type="button"
          className={tool.type === "eraser" ? "active" : ""}
          onClick={() => onToolChange({ type: "eraser", width: activeEraserWidth })}
          title="Scrub erase parts of maze marks"
        >
          <Eraser size={18} />
        </button>
        <button
          type="button"
          className={tool.type === "remove" ? "active" : ""}
          onClick={() => onToolChange({ type: "remove" })}
          title="Remove whole maze marks"
        >
          <X size={18} />
        </button>
        <button
          type="button"
          className={wallTool?.variant === "straight" ? "active" : ""}
          onClick={() =>
            onToolChange({
              type: "wall",
              variant: "straight",
              stroke: wallTool?.stroke ?? presetTool?.stroke ?? "#151413",
              strokeWidth: activeWallWidth
            })
          }
          title="Draw straight maze walls"
        >
          <PenLine size={18} />
        </button>
        <button
          type="button"
          className={wallTool?.variant === "curve" ? "active" : ""}
          onClick={() =>
            onToolChange({
              type: "wall",
              variant: "curve",
              stroke: wallTool?.stroke ?? presetTool?.stroke ?? "#151413",
              strokeWidth: activeWallWidth
            })
          }
          title="Draw curved maze walls"
        >
          <Radius size={18} />
        </button>
      </div>

      <div className="wall-preset-grid" role="group" aria-label="Maze wall forms">
        {wallPresetOptions.map(({ preset, label, glyph }) => (
          <button
            type="button"
            key={preset}
            className={presetTool?.preset === preset ? "active" : ""}
            onClick={() =>
              onToolChange({
                type: "wallPreset",
                preset,
                stroke: wallTool?.stroke ?? presetTool?.stroke ?? "#151413",
                strokeWidth: activeWallWidth,
                size: presetTool?.size ?? 128
              })
            }
            title={`Add ${label} wall`}
            aria-label={`Add ${label} wall`}
          >
            <StampGlyph>{glyph}</StampGlyph>
          </button>
        ))}
      </div>

      <div className="shape-grid" role="group" aria-label="Geometric shape">
        {shapeOptions.map(({ kind, label, Icon }) => (
          <button
            type="button"
            key={kind}
            className={shapeTool?.kind === kind ? "active" : ""}
            onClick={() => setShapeKind(kind)}
            title={`Place ${label}`}
            aria-label={`Place ${label}`}
          >
            <Icon size={19} />
          </button>
        ))}
      </div>

      <div className="swatch-row" aria-label="Maze ink color">
        {inkOptions.map((color) => (
          <button
            type="button"
            key={color}
            className={activeColor === color ? "active" : ""}
            style={{ "--swatch-color": color } as CSSProperties}
            onClick={() => {
              if (tool.type === "wall") {
                onToolChange({ ...tool, stroke: color });
              } else if (tool.type === "wallPreset") {
                onToolChange({ ...tool, stroke: color });
              } else {
                onToolChange({
                  type: "shape",
                  kind: shapeTool?.kind ?? "circle",
                  stroke: "#151413",
                  fill: color,
                  filled: shapeTool?.filled ?? true,
                  size: shapeTool?.size ?? 54
                });
              }
            }}
            title={`Use ${color}`}
            aria-label={`Use ${color}`}
          />
        ))}
      </div>

      <label className="toggle-line">
        <input
          type="checkbox"
          checked={shapeTool?.filled ?? true}
          onChange={(event) =>
            onToolChange({
              type: "shape",
              kind: shapeTool?.kind ?? "circle",
              stroke: "#151413",
              fill: activeColor,
              filled: event.target.checked,
              size: shapeTool?.size ?? 54
            })
          }
        />
        Solid fill
      </label>

      <label className="range-line">
        <span>Wall</span>
        <input
          type="range"
          min="8"
          max="34"
          value={activeWallWidth}
          onChange={(event) =>
            tool.type === "wallPreset"
              ? onToolChange({
                  ...tool,
                  strokeWidth: Number(event.target.value)
                })
              : onToolChange({
                  type: "wall",
                  variant: wallTool?.variant ?? "straight",
                  stroke: wallTool?.stroke ?? activeColor,
                  strokeWidth: Number(event.target.value)
                })
          }
        />
      </label>

      <label className="range-line">
        <span>Erase</span>
        <input
          type="range"
          min="12"
          max="96"
          value={activeEraserWidth}
          onChange={(event) =>
            onToolChange({
              type: "eraser",
              width: Number(event.target.value)
            })
          }
        />
      </label>
    </section>
  );
}
