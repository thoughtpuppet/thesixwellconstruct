export type CanvasItem = {
  instanceId: string;
  symbolId: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  zIndex: number;
};

export type UploadRole = "design-reference" | "editable-artwork" | "body-preview";

export type StudioTab = "design" | "preview" | "maze";

export type ArtworkBlend = "stencil" | "soft-ink" | "guide";

export type AssetKind = "face" | "eye" | "marble" | "feather" | "ornament" | "rim" | "shadow";

export type TattooAssetDefinition = {
  id: string;
  name: string;
  category: string;
  kind: AssetKind;
  eligibleForEmbed: boolean;
  width: number;
  height: number;
  color: string;
  svg: string;
};

export type BaseLayer = {
  instanceId: string;
  name: string;
  role: UploadRole;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
  zIndex: number;
};

export type ArtworkItem = {
  instanceId: string;
  assetId?: string;
  name: string;
  kind: AssetKind | "upload";
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  opacity: number;
  blend: ArtworkBlend;
  locked: boolean;
  zIndex: number;
};

export type EmbeddedEffectSettings = {
  depth: number;
  rim: "clean" | "torn" | "eyelid";
  shadowAngle: number;
  shadowStrength: number;
  overlap: number;
  contourDensity: number;
  outlineOnly: boolean;
};

export type EffectGroup = {
  instanceId: string;
  sourceItem: ArtworkItem;
  settings: EmbeddedEffectSettings;
  zIndex: number;
};

export type PreviewPlacement = {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  opacity: number;
};

export type MazeWall = {
  instanceId: string;
  kind: "straight" | "curve" | "arc" | "culdesac";
  points: number[];
  x?: number;
  y?: number;
  rotation?: number;
  scale?: number;
  size?: number;
  erasedRanges?: Array<[number, number]>;
  stroke: string;
  strokeWidth: number;
  zIndex: number;
};

export type MazeShapeKind = "circle" | "square" | "triangle" | "pentagon" | "hexagon";

export type MazeShape = {
  instanceId: string;
  kind: MazeShapeKind;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  size: number;
  stroke: string;
  fill: string;
  filled: boolean;
  zIndex: number;
};

export type CanvasLayout = "tall" | "square" | "wide";

export type CanvasMode = "standard" | "negative-space";

export type ShapeSizeScope = "selected-future" | "all";

export type CanvasReference = {
  name: string;
  src: string;
  width: number;
  height: number;
};

export type MazeState = {
  canvasLayout: CanvasLayout;
  canvasMode: CanvasMode;
  mazeWalls: MazeWall[];
  mazeShapes: MazeShape[];
};

export type MazeTool =
  | { type: "select" }
  | { type: "eraser"; width: number }
  | { type: "remove" }
  | { type: "wall"; variant: "straight" | "curve"; stroke: string; strokeWidth: number }
  | {
      type: "wallPreset";
      preset:
        | "culdesac"
        | "corner"
        | "tee"
        | "cross"
        | "hook"
        | "pocket"
        | "square"
        | "triangle"
        | "pentagon"
        | "hexagon";
      stroke: string;
      strokeWidth: number;
      size: number;
    }
  | {
      type: "shape";
      kind: MazeShapeKind;
      stroke: string;
      fill: string;
      filled: boolean;
      size: number;
    };

export type Selection =
  | { type: "symbol"; id: string }
  | { type: "wall"; id: string }
  | { type: "shape"; id: string }
  | { type: "artwork"; id: string }
  | { type: "effect"; id: string }
  | { type: "base"; id: string }
  | null;

export type Composition = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  baseLayers: BaseLayer[];
  artworkItems: ArtworkItem[];
  effectGroups: EffectGroup[];
  previewPlacement: PreviewPlacement;
  items: CanvasItem[];
  mazeWalls: MazeWall[];
  mazeShapes: MazeShape[];
};

export type InterpretationLine = {
  id: string;
  title: string;
  body: string;
  tone: "symbol" | "placement" | "relationship" | "composition";
};
