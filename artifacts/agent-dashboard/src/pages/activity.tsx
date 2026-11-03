import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AshActivity } from "@/lib/types";
import { ArrowLeft, Clock, Activity as ActivityIcon, X } from "lucide-react";

const KIND_LABELS: Record<string, string> = {
  diary_entry: "diary_entry",
  bridge: "bridge_crossing",
  status: "Status",
  pings_off: "pings_off",
  pings_on: "pings_on",
  screen_capture: "Screenshot",
  upload: "Upload",
  generated: "Generated image",
  screenshot: "Screenshot",
  song_generated: "Song",
  song_failed: "Song failed",
  proactive_window: "Proactive",
  proactive_failure: "Proactive failed",
  door_opened: "Door opened",
  door_diary: "Diary saved",
  memory_review: "Reviews",
  memory_capture: "Memory capture",
  memory_capture_failure: "Capture failed",
  herald: "Herald comment",
  herald_sweep: "Herald sweep",
  herald_alert: "Herald alert",
  door_failure: "Door failed",
  door_song: "Song queued",
  song_queued: "Song queued",
  door_notes: "Notes added",
  door_books: "Books",
  status_change: "Status changed",
};
const FILTERS = ["All", "Proactive", "Doors", "Reviews", "Memory capture", "Herald"] as const;
type ActivityFilter = (typeof FILTERS)[number];

function matchesFilter(event: AshActivity, filter: ActivityFilter): boolean {
  if (filter === "All") return true;
  if (filter === "Proactive") return event.kind === "proactive_window" || event.kind === "proactive_failure";
  if (filter === "Reviews") return event.kind === "memory_review";
  if (filter === "Memory capture") return event.kind.startsWith("memory_capture");
  if (filter === "Herald") return event.kind === "herald" || event.kind === "herald_sweep" || event.kind === "herald_alert";
  return event.kind.startsWith("door_") || ["diary_entry", "status_change", "song_queued"].includes(event.kind);
}

function SongActivityMessage({ message }: { message: string }) {
  const [title, link] = message.split("\n", 2);
  let safeUrl: string | null = null;
  try {
    const url = new URL(link);
    if (url.protocol === "https:") safeUrl = url.toString();
  } catch {
    // Old or malformed activity messages are displayed as text, never as links.
  }
  return (
    <p className="text-white/70 text-[15px] mt-1">
      {title}
      {safeUrl && (
        <> · <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="text-gold underline underline-offset-2 hover:text-white">Listen to song</a></>
      )}
    </p>
  );
}

function formatEst(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", {
    month: "2-digit", day: "2-digit", year: "2-digit",
    timeZone: "America/New_York",
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: "America/New_York",
  });
  return `${date} ${time} EST`;
}

export default function ActivityPage() {
  const [selectedScreenshot, setSelectedScreenshot] = useState<number | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>("All");
  const { data: events = [], isLoading } = useQuery<AshActivity[]>({
    queryKey: ["/api/activity"],
    refetchInterval: 30_000,
  });
  const filteredEvents = events.filter((event) => matchesFilter(event, filter));
  const productionRuns: { pid: string; start: number; end: number }[] = [];
  for (const event of events) {
    const match = event.message.match(/process=production;\s*pid=(\d+);\s*startedAt=([^;]+);\s*durationMs=(\d+)/);
    if (!match) continue;
    const start = Date.parse(match[2]);
    const end = start + Number(match[3]);
    if (Number.isFinite(start) && Number.isFinite(end)) productionRuns.push({ pid: match[1], start, end });
  }
  const multipleInstances = productionRuns.some((run, index) =>
    productionRuns.slice(index + 1).some((other) =>
      run.pid !== other.pid && run.start <= other.end && other.start <= run.end,
    ),
  );

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-black via-[#0d0a06] to-black">
      <div className="max-w-2xl mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-1">
          <Link
            href="/"
            className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
            data-testid="link-activity-home"
            title="Home"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="font-serif text-2xl text-white font-bold" data-testid="text-activity-title">All Activity</h1>
        </div>
        <div className="mb-5 ml-12 flex flex-wrap gap-2" role="group" aria-label="Filter activity">
          {FILTERS.map((item) => (
            <button key={item} type="button" onClick={() => setFilter(item)}
              aria-pressed={filter === item}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${filter === item ? "border-gold/50 bg-gold/10 text-gold" : "border-white/10 text-white/45 hover:text-white/75"}`}>
              {item}
            </button>
          ))}
        </div>
        {multipleInstances && (
          <p role="alert" className="mb-4 ml-12 border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Multiple instances running
          </p>
        )}
        <p className="text-white/40 text-sm mb-6 ml-12" data-testid="text-activity-count">
          {filteredEvents.length} events across the kingdom
        </p>

        {isLoading && <p className="text-white/30 text-sm ml-12">Loading...</p>}
        {!isLoading && filteredEvents.length === 0 && (
          <p className="text-white/30 text-sm italic font-serif ml-12">Nothing yet. The kingdom is quiet.</p>
        )}

        <div className="divide-y divide-white/10">
          {filteredEvents.map((e) => (
            <div key={e.id} className="py-4 flex items-start gap-3" data-testid={`activity-${e.id}`}>
              <div className="w-10 h-10 rounded-full bg-ember/80 text-black font-bold text-sm flex items-center justify-center shrink-0">
                AC
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white font-semibold">Ash</span>
                  {e.kind === "status" ? (
                    <ActivityIcon className="w-3.5 h-3.5 text-white/40" />
                  ) : (
                    <Clock className="w-3.5 h-3.5 text-white/40" />
                  )}
                  <span className="px-2 py-0.5 rounded-md bg-white/10 border border-white/15 text-xs text-white/70">
                    {KIND_LABELS[e.kind] || e.kind}
                  </span>
                </div>
                {e.kind === "herald_alert"
                  ? <p role="alert" className="mt-1 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-200">{e.message}</p>
                  : e.kind === "herald_sweep"
                  ? <pre className="text-white/70 text-xs mt-1 whitespace-pre-wrap break-words font-mono">{e.message}</pre>
                  : e.kind === "song_generated"
                  ? <SongActivityMessage message={e.message} />
                  : <p className="text-white/70 text-[15px] mt-1">{e.message}</p>}
                {e.kind === "screen_capture" && e.hasScreenshot && (
                  <button
                    type="button"
                    onClick={() => setSelectedScreenshot(e.id)}
                    className="mt-3 block overflow-hidden rounded-lg border border-gold/35 bg-black/60 hover:border-gold/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                    aria-label={`Open screenshot from ${formatEst(e.createdAt)}`}
                  >
                    <img
                      src={`/api/activity/${e.id}/screenshot`}
                      alt=""
                      loading="lazy"
                      className="h-24 w-40 object-cover object-top transition-transform duration-200 hover:scale-[1.03]"
                    />
                  </button>
                )}
                <p className="text-white/35 text-xs mt-1">{formatEst(e.createdAt)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      {selectedScreenshot !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot preview"
          onClick={() => setSelectedScreenshot(null)}
        >
          <button
            type="button"
            onClick={() => setSelectedScreenshot(null)}
            className="absolute right-5 top-5 rounded-full border border-white/20 bg-black/70 p-2 text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            aria-label="Close screenshot"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={`/api/activity/${selectedScreenshot}/screenshot`}
            alt="Persisted desktop screenshot"
            className="max-h-[90vh] max-w-[95vw] rounded-lg border border-gold/35 object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
