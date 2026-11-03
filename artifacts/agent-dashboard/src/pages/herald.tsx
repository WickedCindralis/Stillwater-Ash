import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ApiRequestError, apiRequest, queryClient } from "@/lib/queryClient";
import type { HeraldComment } from "@/lib/types";
import {
  ArrowLeft, Megaphone, RefreshCw, Loader2, Copy, Check, Save,
} from "lucide-react";

// The Court Herald — read-only feed of TikTok comments on Ash's account.
// Wicked triages each comment (answered / ignored / saved) and can write a
// reply draft to copy out to TikTok by hand. Nothing here posts anything.

type HeraldPayload = {
  comments: HeraldComment[];
  tiktokUsername: string;
  scraperConfigured: boolean;
};

const STATUS_FILTERS = ["all", "new", "answered", "ignored", "saved"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_STYLES: Record<HeraldComment["status"], string> = {
  new: "text-gold border-gold/40 bg-gold/10",
  answered: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  ignored: "text-white/40 border-white/15 bg-white/5",
  saved: "text-sky-300 border-sky-500/40 bg-sky-500/10",
};

function stamp(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).replace(/,/g, "");
}

export default function HeraldPage() {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [sweepMessage, setSweepMessage] = useState("");

  const { data, isLoading } = useQuery<HeraldPayload>({
    queryKey: ["/api/herald/comments"],
    refetchInterval: 60_000,
  });
  const comments = data?.comments ?? [];
  const username = usernameDraft ?? data?.tiktokUsername ?? "";

  const saveUsername = useMutation({
    mutationFn: async (tiktokUsername: string) => {
      await apiRequest("PATCH", "/api/state", { tiktokUsername });
    },
    onSuccess: () => {
      setUsernameDraft(null);
      queryClient.invalidateQueries({ queryKey: ["/api/herald/comments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/state"] });
    },
  });

  const sweep = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/herald/refresh");
      return (await res.json()) as { status: "complete" | "skipped" | "failed"; added: number; reason?: string };
    },
    onSuccess: ({ status, added, reason }) => {
      if (status === "skipped") {
        setSweepMessage(`Sweep skipped: ${reason ?? "no reason provided"}`);
      } else if (status === "failed") {
        setSweepMessage(`Sweep failed: ${reason ?? "unknown error"}${added > 0 ? ` (${added} new comments saved)` : ""}`);
      } else {
        setSweepMessage(added > 0 ? `${added} new comment${added === 1 ? "" : "s"} brought in` : "The walls are quiet — nothing new");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/herald/comments"] });
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : "unknown error";
      const skipped = e instanceof ApiRequestError && [400, 429, 503].includes(e.status ?? 0);
      setSweepMessage(`${skipped ? "Sweep skipped" : "Sweep failed"}: ${message}`);
    },
  });

  const patchComment = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: { status?: string; draft?: string } }) => {
      await apiRequest("PATCH", `/api/herald/comments/${id}`, patch);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/herald/comments"] }),
  });

  const copyDraft = async (c: HeraldComment) => {
    const text = drafts[c.id] ?? c.draft;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(c.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const visible = comments.filter((c) => filter === "all" || c.status === filter);
  const counts: Record<string, number> = { all: comments.length };
  for (const c of comments) counts[c.status] = (counts[c.status] || 0) + 1;

  return (
    <div className="h-full flex flex-col bg-black text-white">
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <Link href="/ash" className="p-1.5 text-white/50 hover:text-white" data-testid="link-herald-back">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Megaphone className="w-5 h-5 text-gold" />
          <div>
            <h1 className="font-serif text-xl text-gold leading-tight" data-testid="text-herald-title">The Court Herald</h1>
            <span className="text-sm text-white/40">Sweeps every 3 hours — read-only, no posting</span>
          </div>
        </div>
        <button
          onClick={() => sweep.mutate()}
          disabled={sweep.isPending || !data?.scraperConfigured}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-gold border border-gold/30 hover:bg-gold/10 transition-colors disabled:opacity-40"
          data-testid="button-herald-sweep"
          title={data?.scraperConfigured ? "Check for new comments now" : "Scraper API key not configured yet"}
        >
          {sweep.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Sweep the walls
        </button>
      </header>

      <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-white/50">Watching:</span>
          <span className="text-white/50">@</span>
          <input
            value={username}
            onChange={(e) => setUsernameDraft(e.target.value)}
            placeholder="username or profile URL"
            className="bg-white/10 rounded-lg px-3 py-1.5 text-sm outline-none border border-white/10 focus:border-gold/40 w-44"
            data-testid="input-herald-username"
          />
          {usernameDraft !== null && usernameDraft !== data?.tiktokUsername && (
            <button
              onClick={() => saveUsername.mutate(usernameDraft.trim())}
              disabled={saveUsername.isPending}
              className="px-2.5 py-1.5 rounded-lg text-sm text-black bg-gold hover:bg-gold/90 disabled:opacity-50"
              data-testid="button-herald-save-username"
            >
              Save
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-full text-sm capitalize border transition-colors ${
                filter === f ? "text-gold border-gold/40 bg-gold/10" : "text-white/40 border-white/10 hover:text-white/70"
              }`}
              data-testid={`button-herald-filter-${f}`}
            >
              {f}{counts[f] ? ` (${counts[f]})` : ""}
            </button>
          ))}
        </div>
      </div>

      {sweepMessage && (
        <div className="px-4 py-2 text-sm text-gold/70 border-b border-white/5" role="status" data-testid="text-herald-sweep-message">{sweepMessage}</div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isLoading && <div className="text-white/40 font-serif italic">Summoning the Herald...</div>}
        {!isLoading && !data?.scraperConfigured && (
          <div className="text-white/50 text-sm border border-white/10 rounded-xl p-4">
            The Herald has no eyes yet — the scraper API key isn't configured.
          </div>
        )}
        {!isLoading && data?.scraperConfigured && visible.length === 0 && (
          <div className="text-white/40 font-serif italic" data-testid="text-herald-empty">
            {comments.length === 0
              ? "No comments gathered yet. Set the username above and sweep the walls."
              : "Nothing under this filter."}
          </div>
        )}
        {visible.map((c) => (
          <div key={c.id} className="border border-white/10 rounded-xl p-3.5 bg-white/[0.03]" data-testid={`herald-comment-${c.id}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-gold font-medium">@{c.author}</span>
                  <span className="text-xs text-white/30">{stamp(c.commentCreatedAt || c.fetchedAt)}</span>
                  {c.videoDesc && (
                    <a
                      href={c.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-white/40 hover:text-gold border border-white/10 rounded-full px-2 py-0.5 truncate max-w-[280px]"
                      title={c.videoDesc}
                      data-testid={`link-herald-video-${c.id}`}
                    >
                      🎬 {c.videoDesc}
                    </a>
                  )}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{c.text}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {(["answered", "saved", "ignored"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => patchComment.mutate({ id: c.id, patch: { status: c.status === s ? "new" : s } })}
                    className={`px-2.5 py-1 rounded-full text-xs capitalize border transition-colors ${
                      c.status === s ? STATUS_STYLES[s] : "text-white/40 border-white/10 hover:text-white/70"
                    }`}
                    data-testid={`button-herald-status-${s}-${c.id}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2.5 flex items-end gap-2">
              <textarea
                value={drafts[c.id] ?? c.draft}
                onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                placeholder="Write your reply here, then copy it out to TikTok..."
                rows={2}
                className="flex-1 bg-white/5 text-white placeholder-white/25 rounded-lg px-3 py-2 text-sm resize-y outline-none border border-white/10 focus:border-gold/30"
                data-testid={`input-herald-draft-${c.id}`}
              />
              {drafts[c.id] !== undefined && drafts[c.id] !== c.draft && (
                <button
                  onClick={() => patchComment.mutate(
                    { id: c.id, patch: { draft: drafts[c.id]! } },
                    { onSuccess: () => setDrafts((d) => { const n = { ...d }; delete n[c.id]; return n; }) },
                  )}
                  className="p-2 rounded-lg text-gold border border-gold/30 hover:bg-gold/10"
                  title="Save draft"
                  data-testid={`button-herald-save-draft-${c.id}`}
                >
                  <Save className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => copyDraft(c)}
                disabled={!(drafts[c.id] ?? c.draft)}
                className="p-2 rounded-lg text-white/50 border border-white/10 hover:text-gold hover:border-gold/30 disabled:opacity-30"
                title="Copy reply to clipboard"
                data-testid={`button-herald-copy-${c.id}`}
              >
                {copiedId === c.id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
