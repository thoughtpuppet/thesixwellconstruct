export type OrientationMeaning = {
  label: string;
  min: number;
  max: number;
  meaning: string;
};

export type SymbolDefinition = {
  id: string;
  name: string;
  category: string;
  vocabulary: string;
  baseMeaning: string;
  color: string;
  svg: string;
  orientations: OrientationMeaning[];
  scaleMeaning: {
    small: string;
    large: string;
  };
};

export const symbolLibrary: SymbolDefinition[] = [
  {
    id: "well",
    name: "Well",
    category: "Source",
    vocabulary: "Origin, reserve, memory, protected depth.",
    baseMeaning: "A held source of energy or knowledge.",
    color: "#121212",
    svg: `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <circle cx="60" cy="60" r="43" fill="none" stroke="currentColor" stroke-width="10"/>
      <circle cx="60" cy="60" r="13" fill="currentColor"/>
      <path d="M60 12v20M60 88v20M12 60h20M88 60h20" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
    </svg>`,
    orientations: [
      { label: "upright", min: 315, max: 45, meaning: "open and available" },
      { label: "right-facing", min: 45, max: 135, meaning: "moving into expression" },
      { label: "inverted", min: 135, max: 225, meaning: "hidden, sealed, or internal" },
      { label: "left-facing", min: 225, max: 315, meaning: "returning to memory" }
    ],
    scaleMeaning: {
      small: "quiet influence",
      large: "dominant source"
    }
  },
  {
    id: "gate",
    name: "Gate",
    category: "Threshold",
    vocabulary: "Entry, permission, passage, decision.",
    baseMeaning: "A threshold between states.",
    color: "#6f1d1b",
    svg: `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 102V42c0-16 13-29 29-29h14c16 0 29 13 29 29v60" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>
      <path d="M40 102V46c0-8 7-15 15-15h10c8 0 15 7 15 15v56" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>
      <path d="M21 102h78" stroke="currentColor" stroke-width="10" stroke-linecap="round"/>
    </svg>`,
    orientations: [
      { label: "upright", min: 315, max: 45, meaning: "an open crossing" },
      { label: "right-facing", min: 45, max: 135, meaning: "an invitation to act" },
      { label: "inverted", min: 135, max: 225, meaning: "a blocked or private threshold" },
      { label: "left-facing", min: 225, max: 315, meaning: "a return through the threshold" }
    ],
    scaleMeaning: {
      small: "subtle permission",
      large: "major transition"
    }
  },
  {
    id: "spark",
    name: "Spark",
    category: "Activation",
    vocabulary: "Signal, ignition, sudden knowing, charge.",
    baseMeaning: "An activating force or vivid signal.",
    color: "#d08c23",
    svg: `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <path d="M65 8 34 58h25l-6 54 34-61H63L65 8Z" fill="currentColor"/>
      <path d="M24 18 10 9M96 18l14-9M18 94l-10 12M102 94l10 12" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>
    </svg>`,
    orientations: [
      { label: "upright", min: 315, max: 45, meaning: "direct ignition" },
      { label: "right-facing", min: 45, max: 135, meaning: "outward momentum" },
      { label: "inverted", min: 135, max: 225, meaning: "discharge or spent force" },
      { label: "left-facing", min: 225, max: 315, meaning: "internal charge" }
    ],
    scaleMeaning: {
      small: "brief signal",
      large: "commanding activation"
    }
  },
  {
    id: "thread",
    name: "Thread",
    category: "Connection",
    vocabulary: "Lineage, relation, path, binding.",
    baseMeaning: "A connective path between points.",
    color: "#215a6d",
    svg: `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 74c19-39 44-39 75 0 8 10 17 9 24-3" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>
      <circle cx="19" cy="74" r="10" fill="currentColor"/>
      <circle cx="101" cy="67" r="10" fill="currentColor"/>
    </svg>`,
    orientations: [
      { label: "upright", min: 315, max: 45, meaning: "a visible relationship" },
      { label: "right-facing", min: 45, max: 135, meaning: "connection becoming action" },
      { label: "inverted", min: 135, max: 225, meaning: "submerged or tangled relation" },
      { label: "left-facing", min: 225, max: 315, meaning: "relation to what came before" }
    ],
    scaleMeaning: {
      small: "fine linkage",
      large: "binding structure"
    }
  },
  {
    id: "vessel",
    name: "Vessel",
    category: "Containment",
    vocabulary: "Body, container, protection, carrying.",
    baseMeaning: "A form that holds, protects, or carries.",
    color: "#2f6f4e",
    svg: `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <path d="M35 16h50l-8 21v40c0 17-14 31-31 31S15 94 15 77V37L35 16Z" transform="translate(15)" fill="none" stroke="currentColor" stroke-width="9" stroke-linejoin="round"/>
      <path d="M44 39h32M43 78c12 7 24 7 36 0" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>
    </svg>`,
    orientations: [
      { label: "upright", min: 315, max: 45, meaning: "holding safely" },
      { label: "right-facing", min: 45, max: 135, meaning: "pouring or offering" },
      { label: "inverted", min: 135, max: 225, meaning: "emptying, release, or refusal" },
      { label: "left-facing", min: 225, max: 315, meaning: "receiving from memory" }
    ],
    scaleMeaning: {
      small: "personal container",
      large: "protective field"
    }
  },
  {
    id: "orbit",
    name: "Orbit",
    category: "Field",
    vocabulary: "Cycle, environment, gravity, recurring pattern.",
    baseMeaning: "A surrounding field or repeating pattern.",
    color: "#5a4b81",
    svg: `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="60" cy="60" rx="48" ry="22" fill="none" stroke="currentColor" stroke-width="8"/>
      <ellipse cx="60" cy="60" rx="48" ry="22" fill="none" stroke="currentColor" stroke-width="8" transform="rotate(60 60 60)"/>
      <ellipse cx="60" cy="60" rx="48" ry="22" fill="none" stroke="currentColor" stroke-width="8" transform="rotate(120 60 60)"/>
      <circle cx="60" cy="60" r="9" fill="currentColor"/>
    </svg>`,
    orientations: [
      { label: "upright", min: 315, max: 45, meaning: "stable cycle" },
      { label: "right-facing", min: 45, max: 135, meaning: "cycle accelerating" },
      { label: "inverted", min: 135, max: 225, meaning: "cycle reversed or interrupted" },
      { label: "left-facing", min: 225, max: 315, meaning: "cycle returning" }
    ],
    scaleMeaning: {
      small: "local field",
      large: "dominant atmosphere"
    }
  }
];
