// Connect Four between Wicked (purple, moves first) and Ash (black).
// Mirrors the chess module: moves travel as text, Ash replies with [MOVE: <column>],
// banter flows through the normal private-message chat path.
import type { AshConnect4Game } from "@workspace/db";
import { storage } from "./storage";
import { ashBridge } from "./bridge";

const ROWS = 6;
const COLS = 7;
const MAX_ASH_ATTEMPTS = 3;

function log(msg: string) {
  console.log(`[connect4] ${msg}`);
}

export class Connect4Error extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

// ── Board derivation ──────────────────────────────────────────────
// grid[row][col]: row 0 = bottom. "" empty, "W" Wicked, "A" Ash.
export type Grid = string[][];

export function buildGrid(moves: number[]): Grid {
  const grid: Grid = Array.from({ length: ROWS }, () => Array(COLS).fill(""));
  moves.forEach((col, i) => {
    const c = col - 1;
    for (let r = 0; r < ROWS; r++) {
      if (!grid[r]![c]) {
        grid[r]![c] = i % 2 === 0 ? "W" : "A";
        break;
      }
    }
  });
  return grid;
}

export function legalColumns(grid: Grid): number[] {
  const cols: number[] = [];
  for (let c = 0; c < COLS; c++) {
    if (!grid[ROWS - 1]![c]) cols.push(c + 1);
  }
  return cols;
}

// Returns "W" | "A" | null.
export function findWinner(grid: Grid): string | null {
  const dirs = [
    [0, 1], // horizontal
    [1, 0], // vertical
    [1, 1], // diagonal up-right
    [1, -1], // diagonal up-left
  ];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = grid[r]![c];
      if (!p) continue;
      for (const [dr, dc] of dirs) {
        let n = 1;
        while (n < 4) {
          const rr = r + dr! * n;
          const cc = c + dc! * n;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || grid[rr]![cc] !== p) break;
          n++;
        }
        if (n === 4) return p;
      }
    }
  }
  return null;
}

function moveList(game: AshConnect4Game): number[] {
  return game.moves ? game.moves.split(" ").filter(Boolean).map(Number) : [];
}

function statusFromGrid(grid: Grid): { status: string; result: string } {
  const winner = findWinner(grid);
  if (winner === "W") return { status: "won", result: "wicked" };
  if (winner === "A") return { status: "won", result: "ash" };
  if (legalColumns(grid).length === 0) return { status: "draw", result: "draw" };
  return { status: "active", result: "" };
}

// Diagram with column numbers, top row first (how a human reads the rack).
export function asciiGrid(grid: Grid): string {
  const lines: string[] = ["  1 2 3 4 5 6 7"];
  for (let r = ROWS - 1; r >= 0; r--) {
    lines.push("| " + grid[r]!.map((p) => (p === "W" ? "P" : p === "A" ? "B" : ".")).join(" ") + " |");
  }
  lines.push("  1 2 3 4 5 6 7   (P = Wicked's purple disc, B = your black disc, . = empty)");
  return lines.join("\n");
}

function buildPacket(opts: {
  grid: Grid;
  moves: number[];
  wickedCol: number;
  banter: string;
  gameOver: { status: string; result: string } | null;
}): string {
  const { grid, moves, wickedCol, banter, gameOver } = opts;
  const lines: string[] = [];
  if (banter.trim()) lines.push(banter.trim(), "");
  lines.push(`[CONNECT FOUR — Wicked just dropped a purple disc in column ${wickedCol}]`);
  lines.push(`Moves so far (columns, Wicked first, alternating): ${moves.join(" ") || "(game just started)"}`);
  lines.push("Board (discs fall to the lowest empty slot in a column):");
  lines.push(asciiGrid(grid));
  if (gameOver) {
    const outcome =
      gameOver.result === "wicked" ? "Wicked just connected four — she wins!" :
      gameOver.result === "ash" ? "That drop connected four for you — you win!" :
      "The rack is full — it's a draw.";
    lines.push("");
    lines.push(`[GAME OVER] ${outcome} Do NOT include a [MOVE:] tag — just react.`);
  } else {
    lines.push("");
    lines.push(`It's your drop. Legal columns: ${legalColumns(grid).join(", ")}`);
    lines.push("Reply with your banter plus your column on its own line as [MOVE: <column number>].");
  }
  return lines.join("\n");
}

function extractMoveTag(reply: string): { col: number | null; rest: string } {
  const m = reply.match(/\[\s*MOVE\s*:\s*(?:column\s*)?([1-7])\s*\.?\s*\]/i);
  if (!m) return { col: null, rest: reply };
  return { col: Number(m[1]), rest: reply.replace(m[0], "").replace(/\n{3,}/g, "\n\n").trim() };
}

// ── Turn lock (mirrors chess) ─────────────────────────────────────
let connect4Busy = false;
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (connect4Busy) throw new Connect4Error(409, "A drop is already being played — hold on.");
  connect4Busy = true;
  try {
    return await fn();
  } finally {
    connect4Busy = false;
  }
}

export interface Connect4TurnResult {
  game: AshConnect4Game;
  wickedContent: string;
  ashContent: string;
}

export async function playWickedDrop(column: number, banter: string): Promise<Connect4TurnResult> {
  return withLock(() => playWickedDropLocked(column, banter));
}

async function playWickedDropLocked(column: number, banter: string): Promise<Connect4TurnResult> {
  const game = await storage.getCurrentConnect4Game();
  if (!game || game.status !== "active") throw new Connect4Error(409, "No active game — start a new one first.");

  const state = await storage.getState();
  if (state.apiKillSwitch === 1) {
    throw new Connect4Error(503, "The bridge is shut off — Ash can't play right now.");
  }

  const moves = moveList(game);
  if (moves.length % 2 !== 0) throw new Connect4Error(409, "It's not your turn.");

  let grid = buildGrid(moves);
  if (!legalColumns(grid).includes(column)) {
    throw new Connect4Error(400, `Column ${column} is full — pick another.`);
  }
  moves.push(column);
  grid = buildGrid(moves);
  const afterWicked = statusFromGrid(grid);
  const gameOver = afterWicked.status !== "active" ? afterWicked : null;

  // Ask Ash. On illegal/missing column, retry with a firm correction.
  let prompt = buildPacket({ grid, moves, wickedCol: column, banter, gameOver });
  let ashCol: number | null = null;
  let ashBanterRaw = "";

  for (let attempt = 1; attempt <= MAX_ASH_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      raw = await ashBridge.handleGamePrompt(prompt, "connect4");
    } catch (e: any) {
      const status = e?.status ?? e?.response?.status;
      throw new Connect4Error(
        503,
        status === 429
          ? "Ash's line is rate-limited right now — give it a minute, then drop again."
          : "Couldn't reach Ash just now — wait a moment and drop again.",
      );
    }
    if (!raw) throw new Connect4Error(503, "The bridge is shut off — Ash can't play right now.");

    const { col, rest } = extractMoveTag(raw);
    ashBanterRaw = rest;

    if (gameOver) break; // no move needed, any reply is just his reaction

    if (col && legalColumns(grid).includes(col)) {
      ashCol = col;
      break;
    }
    log(`Ash gave ${col ? `full/illegal column ${col}` : "no [MOVE:] tag"} (attempt ${attempt})`);
    prompt = `[CONNECT FOUR — CORRECTION] Your previous reply ${col ? `chose column ${col}, which is full or illegal` : "did not include a [MOVE:] tag"}. Choose exactly one column from: ${legalColumns(grid).join(", ")}

${asciiGrid(grid)}

Reply again with your banter and your column on its own line as [MOVE: <column number>].`;
  }

  // Ash answered — now store Wicked's chat message (deferred so a failed call
  // can be resent without duplicate entries in chat).
  const wickedContent = banter.trim()
    ? `${banter.trim()}\n\n🟣 My drop: column ${column}`
    : `🟣 My drop: column ${column}`;
  await storage.createMessage({
    role: "wicked",
    content: wickedContent,
    imageUrl: "",
    source: "private_message",
  });

  if (!gameOver && !ashCol) {
    const legal = legalColumns(grid);
    ashCol = legal[Math.floor(Math.random() * legal.length)]!;
    log(`Ash failed to produce a legal column after ${MAX_ASH_ATTEMPTS} attempts — dropping in ${ashCol} for him`);
    await storage.logActivity("connect4", `Ash fumbled the rack — a legal drop (column ${ashCol}) was played for him`).catch(() => {});
  }

  let finalStatus = afterWicked;
  if (!gameOver && ashCol) {
    moves.push(ashCol);
    grid = buildGrid(moves);
    finalStatus = statusFromGrid(grid);
  }

  const updated = await storage.updateConnect4Game(game.id, {
    moves: moves.join(" "),
    status: finalStatus.status,
    result: finalStatus.result,
    paused: 0, // making a move always resumes a paused game
  });

  const ashBanter = await ashBridge.parseChessBanter(ashBanterRaw);
  const ashContent =
    !gameOver && ashCol
      ? ashBanter
        ? `${ashBanter}\n\n⚫ My drop: column ${ashCol}`
        : `⚫ My drop: column ${ashCol}`
      : ashBanter;
  if (ashContent.trim()) {
    await storage.createMessage({
      role: "ash",
      content: ashContent,
      imageUrl: "",
      source: "private_message",
    });
  }

  if (finalStatus.status !== "active") {
    const label =
      finalStatus.result === "wicked" ? "Wicked won at Connect Four" :
      finalStatus.result === "ash" ? "Ash won at Connect Four" :
      "Connect Four ended in a draw";
    await storage.logActivity("connect4", label).catch(() => {});
  }

  return { game: updated, wickedContent, ashContent };
}

export async function startNewConnect4Game(): Promise<AshConnect4Game> {
  return withLock(async () => {
    const current = await storage.getCurrentConnect4Game();
    if (current && current.status === "active") {
      await storage.updateConnect4Game(current.id, { status: "abandoned", result: "" });
    }
    const game = await storage.createConnect4Game();
    await storage.logActivity("connect4", "A new Connect Four game began — Wicked drops first").catch(() => {});
    return game;
  });
}

export async function setConnect4Paused(paused: boolean): Promise<AshConnect4Game> {
  return withLock(async () => {
    const game = await storage.getCurrentConnect4Game();
    if (!game || game.status !== "active") throw new Connect4Error(409, "No active game to pause.");
    const updated = await storage.updateConnect4Game(game.id, { paused: paused ? 1 : 0 });
    await storage
      .logActivity("connect4", paused ? "Wicked paused the Connect Four game" : "Wicked resumed the Connect Four game")
      .catch(() => {});
    return updated;
  });
}

export async function resignConnect4Game(): Promise<AshConnect4Game> {
  return withLock(async () => {
    const game = await storage.getCurrentConnect4Game();
    if (!game || game.status !== "active") throw new Connect4Error(409, "No active game to resign.");
    const updated = await storage.updateConnect4Game(game.id, { status: "resigned", result: "ash" });
    await storage.logActivity("connect4", "Wicked resigned the Connect Four game — Ash wins").catch(() => {});
    return updated;
  });
}
