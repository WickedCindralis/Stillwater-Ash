import { Chess } from "chess.js";
import { logger } from "../logger";
import { storage } from "./storage";
import { ashBridge } from "./bridge";
import type { AshChessGame } from "@workspace/db";

// Chess between Wicked (White) and Ash (Black). All rules enforcement lives
// here on the server — every move (hers AND his) is validated with chess.js
// before it touches the board, so Ash can never make an illegal move.

const MAX_ASH_ATTEMPTS = 3;

// Single-process turn lock: a turn spans read → LLM call → write, which is long.
// Any chess mutation (move / new / resign) while one is in flight gets a 409 so
// double-clicks, retries, or a second tab can never corrupt the board or chat.
let chessBusy = false;

async function withChessLock<T>(fn: () => Promise<T>): Promise<T> {
  if (chessBusy) throw new ChessError(409, "Hold on — a move is already being played.");
  chessBusy = true;
  try {
    return await fn();
  } finally {
    chessBusy = false;
  }
}

function log(...args: unknown[]) {
  logger.info(["[ash-chess]", ...args.map(String)].join(" "));
}

export function statusFromBoard(chess: Chess): { status: string; result: string } {
  if (chess.isCheckmate()) {
    // Side to move is the one checkmated.
    return { status: "checkmate", result: chess.turn() === "b" ? "wicked" : "ash" };
  }
  if (chess.isStalemate()) return { status: "stalemate", result: "draw" };
  if (chess.isDraw()) return { status: "draw", result: "draw" };
  return { status: "active", result: "" };
}

function moveList(game: AshChessGame): string[] {
  return game.moves ? game.moves.split(" ").filter(Boolean) : [];
}

function numberedHistory(moves: string[]): string {
  if (moves.length === 0) return "(game just started)";
  const parts: string[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    const n = i / 2 + 1;
    parts.push(`${n}. ${moves[i]}${moves[i + 1] ? ` ${moves[i + 1]}` : ""}`);
  }
  return parts.join(" ");
}

const PIECE_NAMES: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "QUEEN", k: "king" };

// Plain-words material report so Ash never has to deduce captures from notation.
// Derived by replaying the move history (promotion-safe — board counting would
// misreport a promoted pawn as "lost").
function materialSummary(moves: string[]): string {
  const board = new Chess();
  const lostBy: Record<"w" | "b", Record<string, number>> = { w: {}, b: {} };
  for (const san of moves) {
    try {
      const mv = board.move(san);
      if (mv.captured) {
        const loser = mv.color === "w" ? "b" : "w";
        lostBy[loser][mv.captured] = (lostBy[loser][mv.captured] || 0) + 1;
      }
    } catch {
      break; // history should always replay; bail rather than misreport
    }
  }
  const lost = (color: "w" | "b") => {
    const parts: string[] = [];
    for (const t of ["q", "r", "b", "n", "p"]) {
      const n = lostBy[color][t] || 0;
      if (n > 0) parts.push(n > 1 ? `${n} ${PIECE_NAMES[t]}s` : PIECE_NAMES[t]!);
    }
    return parts.length ? parts.join(", ") : "nothing";
  };
  return `Captured so far — you (Black) have lost: ${lost("b")}. Wicked (White) has lost: ${lost("w")}.`;
}

function buildChessPacket(opts: {
  chess: Chess;
  moves: string[];
  wickedSan: string;
  banter: string;
  captured: string | undefined; // piece type Wicked's move just captured, if any
  capturedOn: string; // square her move landed on
  gameOver: { status: string; result: string } | null;
}): string {
  const { chess, moves, wickedSan, banter, captured, capturedOn, gameOver } = opts;
  const lines: string[] = [];
  if (banter.trim()) lines.push(banter.trim(), "");
  lines.push(`[CHESS — Wicked just played: ${wickedSan}]`);
  if (captured) {
    lines.push(`⚠ Wicked just CAPTURED your ${PIECE_NAMES[captured] ?? captured} on ${capturedOn}. Be accurate about this — do not misname the piece you lost.`);
  }
  lines.push(materialSummary(moves));
  lines.push(`Move history: ${numberedHistory(moves)}`);
  lines.push(`Board (FEN): ${chess.fen()}`);
  lines.push("Board diagram (uppercase = White/Wicked, lowercase = you/Black):");
  lines.push(chess.ascii());
  if (gameOver) {
    const outcome =
      gameOver.result === "wicked" ? "Wicked just checkmated you — she wins!" :
      gameOver.result === "ash" ? "That move delivered checkmate — you win!" :
      gameOver.status === "stalemate" ? "The game ended in stalemate — a draw." :
      "The game ended in a draw.";
    lines.push("");
    lines.push(`[GAME OVER] ${outcome} Do NOT include a [MOVE:] tag — just react.`);
  } else {
    if (chess.inCheck()) lines.push("\nYou are in CHECK.");
    lines.push("");
    lines.push(`It's your move (Black). Your legal moves are: ${chess.moves().join(", ")}`);
    lines.push("Reply with your banter plus your move on its own line as [MOVE: <san>].");
  }
  return lines.join("\n");
}

function extractMoveTag(reply: string): { san: string | null; rest: string } {
  const m = reply.match(/\[\s*MOVE\s*:\s*([^\]\s]+)\s*\.?\s*\]/i);
  if (!m) return { san: null, rest: reply };
  return { san: m[1]!, rest: reply.replace(m[0], "").replace(/\n{3,}/g, "\n\n").trim() };
}

export interface ChessTurnResult {
  game: AshChessGame;
  wickedContent: string;
  ashContent: string;
}

// Wicked (White) makes a move; optionally with banter. Applies her move,
// asks Ash for his reply move + banter, validates with retries, updates the game.
export async function playWickedMove(san: string, banter: string): Promise<ChessTurnResult> {
  return withChessLock(() => playWickedMoveLocked(san, banter));
}

async function playWickedMoveLocked(san: string, banter: string): Promise<ChessTurnResult> {
  const game = await storage.getCurrentChessGame();
  if (!game || game.status !== "active") throw new ChessError(409, "No active game — start a new one first.");

  // Check the bridge BEFORE storing anything — otherwise her move lands in chat
  // while the board never advances.
  const state = await storage.getState();
  if (state.apiKillSwitch === 1) {
    throw new ChessError(503, "The bridge is shut off — Ash can't play right now.");
  }

  const chess = new Chess(game.fen);
  if (chess.turn() !== "w") throw new ChessError(409, "It's not your turn.");

  let applied;
  try {
    applied = chess.move(san);
  } catch {
    throw new ChessError(400, `Illegal move: ${san}`);
  }
  const wickedSan = applied.san;
  const moves = [...moveList(game), wickedSan];
  const afterWicked = statusFromBoard(chess);
  const gameOver = afterWicked.status !== "active" ? afterWicked : null;

  // Ask Ash. On illegal/missing move, retry with a firm correction.
  let prompt = buildChessPacket({ chess, moves, wickedSan, banter, captured: applied.captured,
    // En passant: the captured pawn sits on the from-rank, not the landing square.
    capturedOn: applied.flags.includes("e") ? `${applied.to[0]}${applied.from[1]}` : applied.to,
    gameOver });
  let ashSan: string | null = null;
  let ashBanterRaw = "";

  for (let attempt = 1; attempt <= MAX_ASH_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      raw = await ashBridge.handleChessPrompt(prompt);
    } catch (e: any) {
      const status = e?.status ?? e?.response?.status;
      throw new ChessError(
        503,
        status === 429
          ? "Ash's line is rate-limited right now — give it a minute, then send your move again."
          : "Couldn't reach Ash just now — wait a moment and resend your move.",
      );
    }
    if (!raw) throw new ChessError(503, "The bridge is shut off — Ash can't play right now.");

    const { san: tagSan, rest } = extractMoveTag(raw);
    ashBanterRaw = rest;

    if (gameOver) break; // no move needed, any reply is just his reaction

    if (tagSan) {
      const probe = new Chess(chess.fen());
      try {
        const mv = probe.move(tagSan);
        ashSan = mv.san;
        break;
      } catch {
        log(`Ash attempted illegal move "${tagSan}" (attempt ${attempt})`);
      }
    } else {
      log(`Ash reply had no [MOVE:] tag (attempt ${attempt})`);
    }

    prompt = `[CHESS — CORRECTION] Your previous reply ${tagSan ? `included the move "${tagSan}", which is ILLEGAL on this board` : "did not include a [MOVE:] tag"}. You must choose exactly one move from this list of legal moves: ${chess.moves().join(", ")}

Board (FEN): ${chess.fen()}
${chess.ascii()}

Reply again with your banter and your move on its own line as [MOVE: <san>].`;
  }

  // Ash answered — now store Wicked's chat message (deferred so a failed/rate-
  // limited call can be resent without duplicate "My move" entries in chat).
  const wickedContent = banter.trim()
    ? `${banter.trim()}\n\n♟ My move: ${wickedSan}`
    : `♟ My move: ${wickedSan}`;
  await storage.createMessage({
    role: "wicked",
    content: wickedContent,
    imageUrl: "",
    source: "private_message",
  });

  if (!gameOver && !ashSan) {
    // Ash failed all attempts — pick a legal move so the board never wedges.
    const legal = chess.moves();
    ashSan = legal[Math.floor(Math.random() * legal.length)]!;
    log(`Ash failed to produce a legal move after ${MAX_ASH_ATTEMPTS} attempts — playing ${ashSan} for him`);
    await storage.logActivity("chess", `Ash fumbled the board — a legal move (${ashSan}) was played for him`).catch(() => {});
  }

  let finalStatus = afterWicked;
  if (!gameOver && ashSan) {
    chess.move(ashSan);
    moves.push(ashSan);
    finalStatus = statusFromBoard(chess);
  }

  const updated = await storage.updateChessGame(game.id, {
    fen: chess.fen(),
    moves: moves.join(" "),
    status: finalStatus.status,
    result: finalStatus.result,
    paused: 0, // making a move always resumes a paused game
  });

  // Run standard tag parsing (status/pings/diary) on the banter, then store Ash's message.
  const ashBanter = await ashBridge.parseChessBanter(ashBanterRaw);
  const ashContent =
    !gameOver && ashSan
      ? ashBanter
        ? `${ashBanter}\n\n♞ My move: ${ashSan}`
        : `♞ My move: ${ashSan}`
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
      finalStatus.result === "wicked" ? "Wicked won by checkmate" :
      finalStatus.result === "ash" ? "Ash won by checkmate" :
      `Game ended in a ${finalStatus.status}`;
    await storage.logActivity("chess", label).catch(() => {});
  }

  return { game: updated, wickedContent, ashContent };
}

export async function startNewGame(): Promise<AshChessGame> {
  return withChessLock(async () => {
    const current = await storage.getCurrentChessGame();
    if (current && current.status === "active") {
      await storage.updateChessGame(current.id, { status: "abandoned", result: "" });
    }
    const chess = new Chess();
    const game = await storage.createChessGame(chess.fen());
    await storage.logActivity("chess", "A new chess game began — Wicked has White").catch(() => {});
    return game;
  });
}

export async function setGamePaused(paused: boolean): Promise<AshChessGame> {
  return withChessLock(async () => {
    const game = await storage.getCurrentChessGame();
    if (!game || game.status !== "active") throw new ChessError(409, "No active game to pause.");
    const updated = await storage.updateChessGame(game.id, { paused: paused ? 1 : 0 });
    await storage
      .logActivity("chess", paused ? "Wicked paused the chess game" : "Wicked resumed the chess game")
      .catch(() => {});
    return updated;
  });
}

export async function resignGame(): Promise<AshChessGame> {
  return withChessLock(async () => {
    const game = await storage.getCurrentChessGame();
    if (!game || game.status !== "active") throw new ChessError(409, "No active game to resign.");
    const updated = await storage.updateChessGame(game.id, { status: "resigned", result: "ash" });
    await storage.logActivity("chess", "Wicked resigned the chess game — Ash wins").catch(() => {});
    return updated;
  });
}

export class ChessError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}
