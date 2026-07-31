import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AshConnect4Game, AshMessage } from "@/lib/types";
import { Loader2, Flag, RotateCcw, X, Pause, Play, Send, CircleDot } from "lucide-react";

const ROWS = 6;
const COLS = 7;

// grid[row][col]: row 0 = bottom. "" empty, "W" Wicked (gold), "A" Ash (ember).
function buildGrid(movesSan: number[]): string[][] {
  const grid: string[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(""));
  movesSan.forEach((col, i) => {
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

function columnFree(grid: string[][], col: number): boolean {
  return !grid[ROWS - 1]![col - 1];
}

function statusLine(game: AshConnect4Game, myTurnNow: boolean): string {
  switch (game.status) {
    case "active":
      if (game.paused === 1) return "Game paused — Ash knows you've stepped away.";
      return myTurnNow ? "Your drop — pick a column." : "Ash's drop...";
    case "won":
      return game.result === "wicked" ? "Four in a row — you won! 🟡" : "Ash connected four — he wins. 🔴";
    case "draw":
      return "The rack is full — a draw.";
    case "resigned":
      return "You resigned — Ash takes this one.";
    case "abandoned":
      return "Game abandoned.";
    default:
      return game.status;
  }
}

export default function Connect4Panel({ onClose }: { onClose: () => void }) {
  const [banter, setBanter] = useState("");
  const [error, setError] = useState("");
  const [hoverCol, setHoverCol] = useState<number | null>(null);

  const { data } = useQuery<{ game: AshConnect4Game | null }>({
    queryKey: ["/api/connect4"],
    refetchInterval: 30_000,
  });
  const game = data?.game ?? null;

  const { data: messages = [] } = useQuery<AshMessage[]>({
    queryKey: ["/api/messages"],
    refetchInterval: 10_000,
  });
  const recentMessages = messages.slice(-40);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lastScrolledId = useRef<number | null>(null);
  useEffect(() => {
    const el = chatScrollRef.current;
    const newestId = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1]!.id : null;
    if (el && newestId !== null && lastScrolledId.current !== newestId) {
      lastScrolledId.current = newestId;
      el.scrollTop = el.scrollHeight;
    }
  });

  const moveMutation = useMutation({
    mutationFn: async (payload: { column: number; message: string }) => {
      const res = await apiRequest("POST", "/api/connect4/move", payload);
      return res.json();
    },
    onSuccess: () => {
      setBanter("");
      setError("");
      queryClient.invalidateQueries({ queryKey: ["/api/connect4"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
    },
    onError: (e: Error) => setError(e.message.replace(/^\d+:\s*/, "")),
  });

  const talkMutation = useMutation({
    mutationFn: async (content: string) => {
      await apiRequest("POST", "/api/messages", { content, requestImage: false });
    },
    onSuccess: () => {
      setBanter("");
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
    },
    onError: (e: Error) => setError(e.message.replace(/^\d+:\s*/, "")),
  });

  const newGameMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/connect4/new");
      return res.json();
    },
    onSuccess: () => {
      setError("");
      queryClient.invalidateQueries({ queryKey: ["/api/connect4"] });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async (paused: boolean) => {
      const res = await apiRequest("POST", "/api/connect4/pause", { paused });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/connect4"] }),
  });

  const resignMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/connect4/resign");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/connect4"] }),
  });

  const moves = game?.moves ? game.moves.split(" ").filter(Boolean).map(Number) : [];
  const grid = buildGrid(moves);
  const gameActive = game?.status === "active";
  const myTurn = gameActive && moves.length % 2 === 0 && !moveMutation.isPending;

  const dropIn = (col: number) => {
    if (!myTurn || !columnFree(grid, col)) return;
    setError("");
    moveMutation.mutate({ column: col, message: banter.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-black via-[#0d0a06] to-black overflow-y-auto" data-testid="panel-connect4">
      <div className="max-w-[1700px] mx-auto px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-serif text-2xl sm:text-3xl text-gold flex items-center gap-3">
            <CircleDot className="w-7 h-7" /> Connect Four with Ash
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
            data-testid="button-close-connect4"
            title="Close Connect Four"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {!game || game.status === "abandoned" ? (
          <div className="text-center py-16">
            <p className="text-white/40 font-serif italic text-lg mb-6">
              The rack is empty. Gold drops first — that's you.
            </p>
            <button
              onClick={() => newGameMutation.mutate()}
              disabled={newGameMutation.isPending}
              className="px-6 py-3 rounded-xl bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25 transition-colors font-semibold"
              data-testid="button-start-connect4"
            >
              {newGameMutation.isPending ? "Setting up the rack..." : "Start a game"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Rack column */}
            <div className="flex-1 min-w-0">
              <div className="w-full max-w-[780px] mx-auto select-none">
                {/* Column pickers */}
                <div className="flex mb-1">
                  {Array.from({ length: COLS }, (_, i) => i + 1).map((col) => (
                    <button
                      key={col}
                      onClick={() => dropIn(col)}
                      onMouseEnter={() => setHoverCol(col)}
                      onMouseLeave={() => setHoverCol(null)}
                      disabled={!myTurn || !columnFree(grid, col)}
                      className="flex-1 py-2 text-gold/70 hover:text-gold disabled:opacity-20 transition-colors text-xl leading-none"
                      title={`Drop in column ${col}`}
                      data-testid={`drop-col-${col}`}
                    >
                      ▼
                    </button>
                  ))}
                </div>
                {/* Rack */}
                <div className="rounded-xl border-2 border-gold/30 bg-[#1a1408] p-2" data-testid="connect4-rack">
                  {[...Array(ROWS)].map((_, i) => {
                    const r = ROWS - 1 - i; // render top row first
                    return (
                      <div key={r} className="flex">
                        {grid[r]!.map((cell, c) => (
                          <button
                            key={c}
                            onClick={() => dropIn(c + 1)}
                            onMouseEnter={() => setHoverCol(c + 1)}
                            onMouseLeave={() => setHoverCol(null)}
                            className={`flex-1 aspect-square p-[3.5%] ${
                              myTurn && columnFree(grid, c + 1) ? "cursor-pointer" : "cursor-default"
                            } ${hoverCol === c + 1 && myTurn && columnFree(grid, c + 1) ? "bg-gold/5" : ""}`}
                            data-testid={`cell-${c + 1}-${r + 1}`}
                          >
                            <div
                              className={`w-full h-full rounded-full border ${
                                cell === "W"
                                  ? "bg-gradient-to-br from-purple-400 to-purple-800 border-purple-300/50 shadow-[0_0_12px_rgba(168,85,247,0.45)]"
                                  : cell === "A"
                                    ? "bg-gradient-to-br from-zinc-600 to-black border-zinc-400/40 shadow-[0_0_12px_rgba(140,140,150,0.35)]"
                                    : "bg-black/50 border-white/10"
                              }`}
                            />
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[11px] text-white/25 px-2 mt-1">
                  <span>🟣 You — purple</span>
                  <span>Ash — black ⚫</span>
                </div>
              </div>

              {/* Status + banter composer */}
              <div className="max-w-[780px] mx-auto mt-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-serif italic text-gold/90" data-testid="text-connect4-status">
                    {moveMutation.isPending ? "Ash is eyeing the rack..." : statusLine(game, myTurn)}
                  </p>
                  {moveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin text-gold/70" />}
                </div>
                {error && <p className="text-sm text-red-400" data-testid="text-connect4-error">{error}</p>}

                {gameActive && (
                  <div className="relative">
                    <textarea
                      value={banter}
                      onChange={(e) => setBanter(e.target.value)}
                      placeholder="Say something... it travels with your drop, or send it alone with the arrow →"
                      rows={2}
                      className="w-full bg-white/5 text-white placeholder-white/30 rounded-xl pl-4 pr-12 py-2.5 resize-none outline-none border border-white/10 focus:border-gold/40 text-[15px]"
                      data-testid="input-connect4-banter"
                    />
                    <button
                      onClick={() => banter.trim() && talkMutation.mutate(banter.trim())}
                      disabled={!banter.trim() || talkMutation.isPending || moveMutation.isPending}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 rounded-lg text-gold/70 hover:text-gold hover:bg-gold/10 transition-colors disabled:opacity-30 disabled:cursor-default"
                      title="Send without a drop — ask Ash anything"
                      data-testid="button-connect4-talk"
                    >
                      {talkMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                    </button>
                  </div>
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
                      data-testid="button-connect4-pause"
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
                      data-testid="button-connect4-resign"
                    >
                      <Flag className="w-4 h-4" /> Resign
                    </button>
                  ) : (
                    <button
                      onClick={() => newGameMutation.mutate()}
                      disabled={newGameMutation.isPending}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gold/15 text-gold border border-gold/30 hover:bg-gold/25 transition-colors text-sm font-semibold"
                      data-testid="button-connect4-new"
                    >
                      <RotateCcw className="w-4 h-4" /> New game
                    </button>
                  )}
                </div>
                {gameActive && (
                  <p className="text-xs text-white/25">
                    Tap a column (or the ▼ above it) to drop your disc. Your drop is sent to Ash immediately.
                  </p>
                )}
              </div>
            </div>

            {/* Conversation */}
            <div className="lg:w-[48rem] lg:max-w-[45vw] shrink-0 flex flex-col">
              <h3 className="text-xs uppercase tracking-wider text-gold/70 font-semibold mb-2">Conversation</h3>
              <div
                ref={chatScrollRef}
                className="bg-white/5 border border-white/10 rounded-xl p-4 h-[420px] lg:h-[780px] overflow-y-auto space-y-3"
                data-testid="connect4-chat"
              >
                {recentMessages.length === 0 && (
                  <p className="text-white/25 text-sm italic font-serif">Nothing said yet.</p>
                )}
                {recentMessages.map((m) => {
                  const mine = m.role === "wicked";
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                          mine
                            ? "bg-gold/15 text-white/90 border border-gold/20"
                            : "bg-white/8 text-white/80 border border-white/10"
                        }`}
                      >
                        {m.content}
                      </div>
                    </div>
                  );
                })}
                {(moveMutation.isPending || talkMutation.isPending) && (
                  <div className="flex justify-start">
                    <div className="rounded-xl px-3 py-2 text-sm bg-white/8 text-white/40 border border-white/10 italic font-serif flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Ash is pondering...
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
