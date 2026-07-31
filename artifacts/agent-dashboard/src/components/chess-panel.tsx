import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Chess, type Square } from "chess.js";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AshChessGame } from "@/lib/types";
import { Loader2, Flag, RotateCcw, Swords, X, Pause, Play } from "lucide-react";

const PIECE_GLYPHS: Record<string, string> = {
  wk: "\u2654", wq: "\u2655", wr: "\u2656", wb: "\u2657", wn: "\u2658", wp: "\u2659",
  bk: "\u265A", bq: "\u265B", br: "\u265C", bb: "\u265D", bn: "\u265E", bp: "\u265F",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

const INITIAL_COUNTS: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

function capturedPieces(chess: Chess): { byWicked: string[]; byAsh: string[] } {
  const counts: Record<string, number> = {};
  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq) counts[`${sq.color}${sq.type}`] = (counts[`${sq.color}${sq.type}`] || 0) + 1;
    }
  }
  const byWicked: string[] = []; // black pieces Wicked captured
  const byAsh: string[] = []; // white pieces Ash captured
  for (const t of ["q", "r", "b", "n", "p"]) {
    const missingBlack = INITIAL_COUNTS[t]! - (counts[`b${t}`] || 0);
    const missingWhite = INITIAL_COUNTS[t]! - (counts[`w${t}`] || 0);
    for (let i = 0; i < missingBlack; i++) byWicked.push(PIECE_GLYPHS[`b${t}`]!);
    for (let i = 0; i < missingWhite; i++) byAsh.push(PIECE_GLYPHS[`w${t}`]!);
  }
  return { byWicked, byAsh };
}

function statusLine(game: AshChessGame, chess: Chess): string {
  switch (game.status) {
    case "active":
      if (game.paused === 1) return "Game paused — Ash knows you've stepped away.";
      if (chess.turn() === "w") return chess.inCheck() ? "Your move — you're in check!" : "Your move.";
      return "Ash's move...";
    case "checkmate":
      return game.result === "wicked" ? "Checkmate — you won! \u2654" : "Checkmate — Ash won. \u265A";
    case "stalemate":
      return "Stalemate — a draw.";
    case "draw":
      return "Draw.";
    case "resigned":
      return "You resigned — Ash takes this one.";
    case "abandoned":
      return "Game abandoned.";
    default:
      return game.status;
  }
}

export default function ChessPanel({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<Square | null>(null);
  const [banter, setBanter] = useState("");
  const [error, setError] = useState("");

  const { data } = useQuery<{ game: AshChessGame | null }>({
    queryKey: ["/api/chess"],
    refetchInterval: 30_000,
  });
  const game = data?.game ?? null;

  const chess = useMemo(() => {
    try {
      return game ? new Chess(game.fen) : new Chess();
    } catch {
      return new Chess();
    }
  }, [game?.fen]);

  const legalTargets = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set(chess.moves({ square: selected, verbose: true }).map((m) => m.to));
  }, [selected, chess]);

  const moveMutation = useMutation({
    mutationFn: async (payload: { san: string; message: string }) => {
      const res = await apiRequest("POST", "/api/chess/move", payload);
      return res.json();
    },
    onSuccess: () => {
      setBanter("");
      setError("");
      queryClient.invalidateQueries({ queryKey: ["/api/chess"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
    },
    onError: (e: Error) => setError(e.message.replace(/^\d+:\s*/, "")),
  });

  const newGameMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/chess/new");
      return res.json();
    },
    onSuccess: () => {
      setSelected(null);
      setError("");
      queryClient.invalidateQueries({ queryKey: ["/api/chess"] });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async (paused: boolean) => {
      const res = await apiRequest("POST", "/api/chess/pause", { paused });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/chess"] }),
  });

  const resignMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/chess/resign");
      return res.json();
    },
    onSuccess: () => {
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ["/api/chess"] });
    },
  });

  const gameActive = game?.status === "active";
  const myTurn = gameActive && chess.turn() === "w" && !moveMutation.isPending;

  const handleSquareClick = (square: Square) => {
    if (!myTurn) return;
    setError("");
    const piece = chess.get(square);
    if (selected && legalTargets.has(square)) {
      // Compute SAN on a probe board (auto-queen promotions).
      const probe = new Chess(chess.fen());
      try {
        const mv = probe.move({ from: selected, to: square, promotion: "q" });
        setSelected(null);
        moveMutation.mutate({ san: mv.san, message: banter.trim() });
      } catch {
        setSelected(null);
      }
      return;
    }
    if (piece && piece.color === "w") {
      setSelected(square === selected ? null : square);
    } else {
      setSelected(null);
    }
  };

  const moves = game?.moves ? game.moves.split(" ").filter(Boolean) : [];
  const movePairs: { n: number; white: string; black?: string }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    movePairs.push({ n: i / 2 + 1, white: moves[i]!, black: moves[i + 1] });
  }
  const captured = capturedPieces(chess);
  const board = chess.board(); // rank 8 → rank 1

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-black via-[#0d0a06] to-black overflow-y-auto" data-testid="panel-chess">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-serif text-2xl sm:text-3xl text-gold flex items-center gap-3">
            <Swords className="w-7 h-7" /> Chess with Ash
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
            data-testid="button-close-chess"
            title="Close chess"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {!game || game.status === "abandoned" ? (
          <div className="text-center py-16">
            <p className="text-white/40 font-serif italic text-lg mb-6">
              The board is set. White is yours.
            </p>
            <button
              onClick={() => newGameMutation.mutate()}
              disabled={newGameMutation.isPending}
              className="px-6 py-3 rounded-xl bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25 transition-colors font-semibold"
              data-testid="button-start-game"
            >
              {newGameMutation.isPending ? "Setting the board..." : "Start a game"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Board column */}
            <div className="flex-1 min-w-0">
              {/* Ash's captures (white pieces he took) */}
              <div className="h-7 flex items-center gap-0.5 text-xl text-white/70 px-1" data-testid="captured-by-ash">
                {captured.byAsh.map((g, i) => <span key={i}>{g}</span>)}
              </div>

              <div className="aspect-square w-full max-w-[560px] mx-auto rounded-lg overflow-hidden border-2 border-gold/30 select-none" data-testid="chess-board">
                {board.map((rank, r) => (
                  <div key={r} className="flex" style={{ height: "12.5%" }}>
                    {rank.map((sq, f) => {
                      const square = `${FILES[f]}${8 - r}` as Square;
                      const dark = (r + f) % 2 === 1;
                      const isSelected = selected === square;
                      const isTarget = legalTargets.has(square);
                      const glyph = sq ? PIECE_GLYPHS[`${sq.color}${sq.type}`] : "";
                      return (
                        <button
                          key={square}
                          onClick={() => handleSquareClick(square)}
                          className={`relative flex-1 flex items-center justify-center transition-colors ${
                            dark ? "bg-[#3d3020]" : "bg-[#6b5a3e]"
                          } ${isSelected ? "ring-2 ring-inset ring-gold" : ""} ${
                            myTurn && (isTarget || (sq && sq.color === "w")) ? "cursor-pointer hover:brightness-125" : "cursor-default"
                          }`}
                          data-testid={`square-${square}`}
                        >
                          {glyph && (
                            <span
                              className="leading-none"
                              style={{
                                fontSize: "min(6.5vw, 38px)",
                                color: sq!.color === "w" ? "#f5e9d0" : "#1a120a",
                                textShadow: sq!.color === "w" ? "0 1px 2px rgba(0,0,0,0.8)" : "0 1px 1px rgba(255,255,255,0.15)",
                              }}
                            >
                              {glyph}
                            </span>
                          )}
                          {isTarget && (
                            <span className={`absolute rounded-full ${sq ? "inset-0.5 border-2 border-gold/70" : "w-1/4 h-1/4 bg-gold/60"}`} />
                          )}
                          {f === 0 && (
                            <span className="absolute top-0.5 left-1 text-[9px] text-white/30">{8 - r}</span>
                          )}
                          {r === 7 && (
                            <span className="absolute bottom-0.5 right-1 text-[9px] text-white/30">{FILES[f]}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Wicked's captures (black pieces she took) */}
              <div className="h-7 flex items-center gap-0.5 text-xl text-white/70 px-1" data-testid="captured-by-wicked">
                {captured.byWicked.map((g, i) => <span key={i}>{g}</span>)}
              </div>

              {/* Status + banter composer */}
              <div className="max-w-[560px] mx-auto mt-2 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-serif italic text-gold/90" data-testid="text-chess-status">
                    {moveMutation.isPending ? "Ash is pondering his move..." : statusLine(game, chess)}
                  </p>
                  {moveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin text-gold/70" />}
                </div>
                {error && <p className="text-sm text-red-400" data-testid="text-chess-error">{error}</p>}

                {gameActive && (
                  <textarea
                    value={banter}
                    onChange={(e) => setBanter(e.target.value)}
                    placeholder="Say something with your move... (travels to Ash with it)"
                    rows={2}
                    className="w-full bg-white/5 text-white placeholder-white/30 rounded-xl px-4 py-2.5 resize-none outline-none border border-white/10 focus:border-gold/40 text-[15px]"
                    data-testid="input-chess-banter"
                  />
                )}

                <div className="flex gap-2">
                  {gameActive && (
                    <button
                      onClick={() => pauseMutation.mutate(game.paused !== 1)}
                      disabled={pauseMutation.isPending || moveMutation.isPending}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors text-sm disabled:opacity-40 ${
                        game.paused === 1
                          ? "bg-gold/15 text-gold border-gold/30 hover:bg-gold/25 font-semibold"
                          : "bg-white/5 text-white/50 border-white/10 hover:text-gold hover:border-gold/30"
                      }`}
                      data-testid="button-pause"
                    >
                      {game.paused === 1 ? (
                        <><Play className="w-4 h-4" /> Resume game</>
                      ) : (
                        <><Pause className="w-4 h-4" /> Pause game</>
                      )}
                    </button>
                  )}
                  {gameActive ? (
                    <button
                      onClick={() => resignMutation.mutate()}
                      disabled={resignMutation.isPending || moveMutation.isPending}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 text-white/50 border border-white/10 hover:text-red-400 hover:border-red-500/30 transition-colors text-sm disabled:opacity-40"
                      data-testid="button-resign"
                    >
                      <Flag className="w-4 h-4" /> Resign
                    </button>
                  ) : (
                    <button
                      onClick={() => newGameMutation.mutate()}
                      disabled={newGameMutation.isPending}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25 transition-colors text-sm font-semibold"
                      data-testid="button-new-game"
                    >
                      <RotateCcw className="w-4 h-4" /> New game
                    </button>
                  )}
                </div>
                {gameActive && (
                  <p className="text-xs text-white/25">
                    Tap one of your pieces, then tap where it goes. Your move is sent to Ash immediately.
                  </p>
                )}
              </div>
            </div>

            {/* Move history */}
            <div className="lg:w-56 shrink-0">
              <h3 className="text-xs uppercase tracking-wider text-gold/70 font-semibold mb-2">Moves</h3>
              <div className="bg-white/5 border border-white/10 rounded-xl p-3 max-h-[420px] overflow-y-auto" data-testid="move-history">
                {movePairs.length === 0 && (
                  <p className="text-white/25 text-sm italic font-serif">No moves yet.</p>
                )}
                <table className="w-full text-sm">
                  <tbody>
                    {movePairs.map((p) => (
                      <tr key={p.n} className="text-white/70">
                        <td className="text-white/30 pr-2 py-0.5 w-8">{p.n}.</td>
                        <td className="py-0.5">{p.white}</td>
                        <td className="py-0.5">{p.black || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
