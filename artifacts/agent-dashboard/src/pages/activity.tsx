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
};

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
  const { data: events = [], isLoading } = useQuery<AshActivity[]>({
    queryKey: ["/api/activity"],
    refetchInterval: 30_000,
  });

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
        <p className="text-white/40 text-sm mb-6 ml-12" data-testid="text-activity-count">
          {events.length} events across the kingdom
        </p>

        {isLoading && <p className="text-white/30 text-sm ml-12">Loading...</p>}
        {!isLoading && events.length === 0 && (
          <p className="text-white/30 text-sm italic font-serif ml-12">Nothing yet. The kingdom is quiet.</p>
        )}

        <div className="divide-y divide-white/10">
          {events.map((e) => (
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
                <p className="text-white/70 text-[15px] mt-1">{e.message}</p>
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
