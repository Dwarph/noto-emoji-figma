import { DEFAULT_PREFS, type CodeToUi, type InsertRequest, type InsertSpec, type Prefs, type UiToCode } from "./shared";

const PREFS_KEY = "prefs";
const RECENTS_KEY = "recents";

// FitXR desktop styling is light-only, so Figma theme colours are not injected.
figma.showUI(__html__, { width: 400, height: 600 });

const post = (msg: CodeToUi) => figma.ui.postMessage(msg);

(async () => {
  const prefs = { ...DEFAULT_PREFS, ...((await figma.clientStorage.getAsync(PREFS_KEY)) as Partial<Prefs> | undefined) };
  const recents = ((await figma.clientStorage.getAsync(RECENTS_KEY)) as string[] | undefined) ?? [];
  post({ type: "init", prefs, recents });
})();

// The UI sizes its drag preview to match the canvas, so keep it told about zoom changes.
// (There's no viewport-change event, so poll; it only posts when the value changes.)
let lastZoom = 0;
setInterval(() => {
  const zoom = figma.viewport.zoom;
  if (zoom !== lastZoom) {
    lastZoom = zoom;
    post({ type: "zoom", zoom });
  }
}, 250);

// --- Drops: remember where it landed, ask the UI to fetch the asset, then insert there. ---

interface PendingDrop {
  parent: BaseNode & ChildrenMixin;
  x: number;
  y: number;
}

const pendingDrops = new Map<number, PendingDrop>();
let nextDropId = 1;

figma.on("drop", (event: DropEvent) => {
  const spec = event.dropMetadata as InsertSpec | undefined;
  if (!spec?.codepoint) return true; // not ours; let Figma handle it

  const node = event.node;
  const parent = "appendChild" in node && node.type !== "INSTANCE" ? (node as BaseNode & ChildrenMixin) : figma.currentPage;
  const dropId = nextDropId++;
  // event.x/y are relative to the drop target node; centre the emoji on the cursor.
  pendingDrops.set(dropId, { parent, x: event.x - spec.size / 2, y: event.y - spec.size / 2 });
  post({ type: "drop-request", dropId, spec });
  return false;
});

// --- Messages from the UI ---

figma.ui.onmessage = async (msg: UiToCode) => {
  switch (msg.type) {
    case "insert":
      try {
        await insert(msg.req);
        post({ type: "inserted", codepoint: msg.req.codepoint });
      } catch (err) {
        console.error(err);
        figma.notify(`Couldn't insert ${msg.req.char}: ${(err as Error).message}`, { error: true });
      }
      break;
    case "save-prefs":
      await figma.clientStorage.setAsync(PREFS_KEY, msg.prefs);
      break;
    case "save-recents":
      await figma.clientStorage.setAsync(RECENTS_KEY, msg.recents);
      break;
    case "notify":
      figma.notify(msg.text, { error: msg.error });
      break;
  }
};

async function insert(req: InsertRequest) {
  // With dynamic page loading, Figma requires the page to be loaded before we append to it.
  await figma.currentPage.loadAsync();
  const node = req.svg ? fromSvg(req.svg, req.size) : await fromImage(req.bytes!, req.size);

  const style = req.style === "3d" ? "3D" : "2D";
  node.name = `${req.char} ${req.name} · Noto ${style}${req.animated ? " · animated" : ""}`;
  node.setPluginData("codepoint", req.codepoint);
  node.setPluginData("style", req.style);
  node.setPluginData("animated", String(req.animated));

  const drop = req.dropId !== undefined ? pendingDrops.get(req.dropId) : undefined;
  if (drop) {
    pendingDrops.delete(req.dropId!);
    drop.parent.appendChild(node);
    node.x = Math.round(drop.x);
    node.y = Math.round(drop.y);
  } else {
    place(node);
  }

  figma.currentPage.selection = [node];
}

/** 2D static: editable vectors, scaled so the whole frame is `size` px square. */
function fromSvg(svg: string, size: number): FrameNode {
  const frame = figma.createNodeFromSvg(svg);
  frame.rescale(size / Math.max(frame.width, frame.height));
  frame.fills = [];
  frame.clipsContent = false;
  return frame;
}

/** 3D static (PNG) or animated (GIF): an image-filled rectangle. */
async function fromImage(bytes: Uint8Array, size: number): Promise<RectangleNode> {
  const image = figma.createImage(bytes);
  const rect = figma.createRectangle();
  rect.resize(size, size);
  rect.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FIT" }];
  return rect;
}

const CONTAINER_TYPES = new Set<NodeType>(["FRAME", "COMPONENT", "SECTION", "GROUP"]);

/** Inside the single selected container if there is one, otherwise the viewport centre. */
function place(node: SceneNode) {
  const sel = figma.currentPage.selection;
  const target = sel.length === 1 && CONTAINER_TYPES.has(sel[0].type) ? (sel[0] as FrameNode | ComponentNode | SectionNode | GroupNode) : null;

  if (target && target.type !== "GROUP") {
    target.appendChild(node);
    const isAutoLayout = "layoutMode" in target && target.layoutMode !== "NONE";
    if (!isAutoLayout) {
      node.x = Math.round((target.width - node.width) / 2);
      node.y = Math.round((target.height - node.height) / 2);
    }
    return;
  }

  if (target?.type === "GROUP") {
    // Group children use the parent's coordinate space.
    target.appendChild(node);
    node.x = Math.round(target.x + (target.width - node.width) / 2);
    node.y = Math.round(target.y + (target.height - node.height) / 2);
    return;
  }

  const { x, y } = figma.viewport.center;
  figma.currentPage.appendChild(node);
  node.x = Math.round(x - node.width / 2);
  node.y = Math.round(y - node.height / 2);
}
