export type Style = "2d" | "3d";

export interface Prefs {
  style: Style;
  animated: boolean;
  tone: number; // 0 = default yellow, 1..5 = Fitzpatrick tones
  size: number;
}

export const DEFAULT_PREFS: Prefs = { style: "2d", animated: false, tone: 0, size: 64 };

/** What to insert, resolved by the UI (skin tone applied, availability checked). */
export interface InsertSpec {
  codepoint: string;
  char: string;
  name: string;
  style: Style;
  animated: boolean;
  size: number;
}

export interface InsertRequest extends InsertSpec {
  /** Present for 2D static inserts. */
  svg?: string;
  /** Present for PNG / GIF inserts. */
  bytes?: Uint8Array;
  /** Present when the insert came from a canvas drop. */
  dropId?: number;
}

export type UiToCode =
  | { type: "insert"; req: InsertRequest }
  | { type: "save-prefs"; prefs: Prefs }
  | { type: "save-recents"; recents: string[] }
  | { type: "notify"; text: string; error?: boolean };

export type CodeToUi =
  | { type: "init"; prefs: Prefs; recents: string[] }
  | { type: "drop-request"; dropId: number; spec: InsertSpec }
  | { type: "inserted"; codepoint: string }
  | { type: "zoom"; zoom: number };
