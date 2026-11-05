import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Disc3, Download, Music2, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

type MusicClip = {
  id: string | number;
  title: string;
  audioUrl: string;
  downloadUrl: string;
};

type MusicEntry = {
  id: string | number;
  title: string;
  sound: string;
  lyrics: string;
  createdAt: string;
  trigger: string;
  status: "in_progress" | "generated" | "failed";
  failureReason: string | null;
  clips: MusicClip[];
};

const statusLabel: Record<MusicEntry["status"], string> = {
  in_progress: "In progress",
  generated: "Generated",
  failed: "Failed",
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function MusicPage() {
  const musicQuery = useQuery<MusicEntry[]>({
    queryKey: ["/api/music"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/music");
      return (await response.json()) as MusicEntry[];
    },
  });

  return (
    <main className="h-full overflow-y-auto bg-gradient-to-b from-black via-[#100c08] to-black text-white">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gold/65 transition-colors hover:text-gold"
          data-testid="link-music-home"
        >
          <ArrowLeft className="h-4 w-4" />
          Stillwater
        </Link>

        <header className="relative mt-8 overflow-hidden rounded-3xl border border-gold/25 bg-[#15100a]/85 px-5 py-8 shadow-[0_22px_70px_rgba(0,0,0,0.35)] sm:px-9 sm:py-10">
          <div className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full border border-gold/10" />
          <div className="pointer-events-none absolute -right-3 -top-11 h-48 w-48 rounded-full border border-gold/10" />
          <div className="relative flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <div className="mb-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-gold/55">
                <Disc3 className="h-4 w-4" />
                Ash Cindralis · personal archive
              </div>
              <h1 className="font-serif text-5xl leading-none text-gold sm:text-6xl" data-testid="text-music-title">
                Music
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-white/55">
                Songs kept in the Stillwater record: the sound, the words, and every rendered take.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void musicQuery.refetch()}
              disabled={musicQuery.isFetching}
              className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-full border border-gold/30 px-4 text-xs tracking-wide text-gold/80 transition-colors hover:border-gold/60 hover:bg-gold/5 disabled:cursor-wait disabled:opacity-50 sm:self-auto"
              data-testid="button-music-refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${musicQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh archive
            </button>
          </div>
          <div className="relative mt-7 border-t border-gold/15 pt-4 text-[11px] uppercase tracking-[0.17em] text-white/35">
            {musicQuery.data ? `${musicQuery.data.length} ${musicQuery.data.length === 1 ? "record" : "records"}` : "Private listening room"}
            <span className="px-2 text-gold/35">/</span>
            Newest first
          </div>
        </header>

        {musicQuery.isLoading ? (
          <section className="mt-7 space-y-4" aria-label="Loading music archive" data-testid="loading-music">
            {[0, 1].map((item) => (
              <div key={item} className="animate-pulse rounded-2xl border border-gold/10 bg-[#100d09] p-6">
                <div className="h-5 w-2/5 rounded bg-gold/10" />
                <div className="mt-4 h-3 w-1/3 rounded bg-white/5" />
                <div className="mt-8 h-20 rounded-xl bg-white/[0.035]" />
              </div>
            ))}
          </section>
        ) : musicQuery.isError ? (
          <section className="mt-7 rounded-2xl border border-red-900/60 bg-[#180e0b] p-6 sm:p-8" data-testid="state-music-error">
            <p className="font-serif text-2xl text-gold">The archive is out of reach.</p>
            <p className="mt-2 text-sm text-white/55">Stillwater could not retrieve the music records. Your session remains private; try again in a moment.</p>
            <button
              type="button"
              onClick={() => void musicQuery.refetch()}
              className="mt-5 rounded-full border border-gold/35 px-4 py-2 text-xs text-gold transition-colors hover:bg-gold/10"
              data-testid="button-music-retry"
            >
              Try again
            </button>
          </section>
        ) : musicQuery.data?.length ? (
          <section className="mt-7 space-y-5" aria-label="Music records" data-testid="list-music-records">
            {musicQuery.data.map((entry, index) => (
              <article
                key={entry.id}
                className="overflow-hidden rounded-2xl border border-gold/20 bg-[#100d09]/95"
                data-testid={`card-music-entry-${entry.id}`}
              >
                <div className="border-b border-gold/10 px-5 py-5 sm:px-7">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div className="min-w-0">
                      <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-gold/45">
                        Record {String(index + 1).padStart(2, "0")} <span className="px-1">·</span> ID {entry.id}
                      </div>
                      <h2 className="break-words font-serif text-3xl leading-tight text-gold sm:text-4xl" data-testid={`text-music-entry-title-${entry.id}`}>
                        {entry.title || "Untitled"}
                      </h2>
                    </div>
                    <span
                      className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.14em] ${
                        entry.status === "generated"
                          ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-200/80"
                          : entry.status === "failed"
                            ? "border-red-900/70 bg-red-950/40 text-red-200/80"
                            : "border-amber-800/60 bg-amber-950/30 text-amber-100/80"
                      }`}
                      data-testid={`status-music-entry-${entry.id}`}
                    >
                      {statusLabel[entry.status] ?? entry.status}
                    </span>
                  </div>
                  <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
                    <div>
                      <dt className="text-[9px] uppercase tracking-[0.18em] text-white/35">Created</dt>
                      <dd className="mt-1 text-white/70" data-testid={`text-music-created-${entry.id}`}>{formatDate(entry.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-[9px] uppercase tracking-[0.18em] text-white/35">Trigger</dt>
                      <dd className="mt-1 break-words text-white/70" data-testid={`text-music-trigger-${entry.id}`}>{entry.trigger || "—"}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-[9px] uppercase tracking-[0.18em] text-white/35">Failure reason</dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words text-white/60" data-testid={`text-music-failure-${entry.id}`}>
                        {entry.failureReason || "None reported"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="grid gap-0 lg:grid-cols-[0.82fr_1.18fr]">
                  <section className="border-b border-gold/10 px-5 py-5 sm:px-7 lg:border-b-0 lg:border-r" data-testid={`section-music-sound-${entry.id}`}>
                    <h3 className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-gold/65">
                      <Music2 className="h-3.5 w-3.5" />
                      Sound
                    </h3>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-white/75" data-testid={`text-music-sound-${entry.id}`}>
                      {entry.sound || "—"}
                    </p>
                  </section>
                  <section className="px-5 py-5 sm:px-7" data-testid={`section-music-lyrics-${entry.id}`}>
                    <h3 className="text-[10px] uppercase tracking-[0.2em] text-gold/65">Lyrics · complete submission</h3>
                    <pre className="mt-3 max-h-[34rem] overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-6 text-white/75" data-testid={`text-music-lyrics-${entry.id}`}>
                      {entry.lyrics ?? ""}
                    </pre>
                  </section>
                </div>

                <section className="border-t border-gold/10 bg-black/20 px-5 py-5 sm:px-7" data-testid={`section-music-clips-${entry.id}`}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="text-[10px] uppercase tracking-[0.2em] text-gold/65">Clips</h3>
                    <span className="text-[10px] text-white/35">{entry.clips?.length ?? 0} available</span>
                  </div>
                  {entry.clips?.length ? (
                    <div className="space-y-3">
                      {entry.clips.map((clip) => (
                        <div key={clip.id} className="flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 sm:flex-row sm:items-center" data-testid={`row-music-clip-${clip.id}`}>
                          <div className="min-w-0 flex-1">
                            <p className="mb-2 truncate text-sm text-white/80" data-testid={`text-music-clip-title-${clip.id}`}>{clip.title || "Untitled clip"}</p>
                            <audio
                              className="h-9 w-full max-w-xl accent-[#c9a84c]"
                              controls
                              preload="none"
                              src={clip.audioUrl}
                              aria-label={`Audio player: ${clip.title}`}
                              data-testid={`audio-music-clip-${clip.id}`}
                            >
                              Your browser does not support audio playback.
                            </audio>
                          </div>
                          <a
                            href={clip.downloadUrl}
                            download
                            className="inline-flex min-h-9 items-center justify-center gap-2 self-start rounded-full border border-gold/25 px-3 text-[10px] uppercase tracking-[0.12em] text-gold/80 transition-colors hover:border-gold/55 hover:bg-gold/5 sm:self-auto"
                            data-testid={`link-download-music-clip-${clip.id}`}
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-white/35" data-testid={`text-music-no-clips-${entry.id}`}>No clips returned for this record.</p>
                  )}
                </section>
              </article>
            ))}
          </section>
        ) : (
          <section className="mt-7 rounded-2xl border border-gold/15 bg-[#100d09]/80 px-6 py-12 text-center" data-testid="state-music-empty">
            <Disc3 className="mx-auto h-8 w-8 text-gold/45" />
            <h2 className="mt-4 font-serif text-2xl text-gold/85">Nothing on the shelf yet.</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-white/45">When a song enters Stillwater, its sound, lyrics, and clips will be kept here.</p>
          </section>
        )}
      </div>
    </main>
  );
}
