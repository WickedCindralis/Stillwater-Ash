import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Feather,
  Loader2,
  PencilLine,
  Play,
  RefreshCw,
  ScrollText,
  Sparkles,
} from "lucide-react";
import {
  useBooks,
  useStory,
  useUpdateManuscript,
  useUpdateChapter,
  useWriteStory,
  type StoryChapter,
  type StoryManuscript,
} from "@/hooks/use-story";

type LibraryBook = {
  id: string;
  title: string;
  chapterCount?: number;
  createdAt: string;
  lastWrittenAt: string | null;
  runStatus?: string;
};

const formatDate = (value?: string | null) => {
  if (!value) return "Not written yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not written yet";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
};

export default function StoryPage() {
  const booksQuery = useBooks();
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<number | null>(null);
  const { data, isLoading, error, refetch, isFetching } = useStory(selectedBookId);

  if (!selectedBookId) {
    return (
      <Library
        books={(booksQuery.data?.books ?? []) as LibraryBook[]}
        isLoading={booksQuery.isLoading}
        isError={booksQuery.isError}
        error={booksQuery.error}
        onRetry={() => booksQuery.refetch()}
        onOpen={(id) => {
          setSelectedBookId(id);
          setActiveChapterId(null);
        }}
      />
    );
  }

  if (isLoading) {
    return <LoadingBook onBack={() => setSelectedBookId(null)} />;
  }

  if (error || !data) {
    return (
      <BookLoadError
        error={error}
        isFetching={isFetching}
        onRetry={() => refetch()}
        onBack={() => {
          setSelectedBookId(null);
          setActiveChapterId(null);
        }}
      />
    );
  }

  return (
    <BookWorkspace
      manuscript={data.manuscript}
      chapters={data.chapters}
      activeChapterId={activeChapterId}
      onSelectChapter={setActiveChapterId}
      onBack={() => {
        setSelectedBookId(null);
        setActiveChapterId(null);
      }}
    />
  );
}

function Library({
  books,
  isLoading,
  isError,
  error,
  onRetry,
  onOpen,
}: {
  books: LibraryBook[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onOpen: (id: string) => void;
}) {
  const activeBookId = books.find((book) => book.runStatus === "running")?.id;
  const errorDetail = isError ? parseQueryError(error) : null;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[#11100e] text-[#eee8dc]">
      <header className="sticky top-0 z-10 border-b border-[#c9a84c]/15 bg-[#11100e]/95 px-5 py-3 backdrop-blur-md sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="rounded-lg p-2 text-white/45 transition hover:bg-white/5 hover:text-[#e0c76a]" aria-label="Back to home" data-testid="link-library-home">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className="h-5 w-px bg-white/10" />
            <BookOpen className="h-4 w-4 text-[#c9a84c]" />
            <span className="font-serif text-lg tracking-wide text-[#e0c76a]">Stillwater</span>
            <span className="hidden text-xs text-white/30 sm:inline">/</span>
            <span className="hidden text-sm text-white/60 sm:inline">Library</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/35">
            <span className="h-1.5 w-1.5 rounded-full bg-[#c9a84c]" />
            Ash’s private library
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14">
        <div className="relative mb-10 overflow-hidden border-b border-[#c9a84c]/20 pb-9">
          <div className="absolute -right-4 -top-12 select-none font-serif text-[13rem] leading-none text-[#c9a84c]/[0.035]">W</div>
          <div className="relative">
            <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#c9a84c]/65">
              <Feather className="h-3.5 w-3.5" />
              The working shelf
            </div>
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <div>
                <h1 className="font-serif text-5xl tracking-[-0.04em] text-[#efe6d5] sm:text-6xl">Ash’s books</h1>
                <p className="mt-3 max-w-lg text-sm leading-6 text-white/45">
                  The stories in progress, and the pages they’ve left behind.
                </p>
              </div>
              <div className="font-mono text-xs text-white/35">
                <span className="text-[#d8bd70]">{books.length.toString().padStart(2, "0")}</span>
                <span className="ml-2 uppercase tracking-[0.16em]">volumes</span>
              </div>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3" aria-label="Loading library">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-28 animate-pulse border border-white/[0.06] bg-white/[0.025]" />
            ))}
          </div>
        ) : isError ? (
          <div className="border border-[#9d5d4b]/30 bg-[#9d5d4b]/[0.06] px-6 py-8">
            <p className="font-serif text-xl text-[#e6b7a2]">The shelf could not be reached.</p>
            <p className="mt-2 font-mono text-xs text-[#dfa58c]">HTTP {errorDetail?.status}</p>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-white/55" data-testid="text-library-error-message">{errorDetail?.message}</pre>
            {errorDetail?.url && <p className="mt-2 break-all font-mono text-[10px] text-white/30">{errorDetail.url}</p>}
            <button onClick={onRetry} className="mt-5 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-[#e0c76a] hover:text-white" data-testid="button-retry-library">
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
          </div>
        ) : books.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center border border-dashed border-[#c9a84c]/20 bg-[#c9a84c]/[0.025] px-6 text-center">
            <ScrollText className="h-7 w-7 text-[#c9a84c]/45" />
            <h2 className="mt-4 font-serif text-2xl text-[#e8decb]">An empty shelf, for now.</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-white/40">When a book is ready to be opened, it will find its place here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {books.map((book, index) => {
              const isActive = book.id === activeBookId;
              return (
                <button
                  key={book.id}
                  onClick={() => onOpen(book.id)}
                  className={`group relative grid w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-4 overflow-hidden border px-4 py-5 text-left transition duration-200 sm:grid-cols-[3rem_minmax(0,1fr)_10rem_10rem_1.5rem] sm:px-6 ${
                    isActive
                      ? "border-[#c9a84c]/40 bg-[#c9a84c]/[0.075]"
                      : "border-white/[0.075] bg-white/[0.018] hover:border-[#c9a84c]/25 hover:bg-white/[0.04]"
                  }`}
                  data-testid={`button-open-book-${book.id}`}
                >
                  {isActive && <span className="absolute inset-y-0 left-0 w-0.5 bg-[#d8bd70]" />}
                  <span className="font-mono text-xs text-[#c9a84c]/45">{String(index + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-serif text-xl text-[#eee5d5] transition group-hover:text-[#e0c76a]">{book.title || "Untitled book"}</span>
                      {isActive && (
                        <span className="inline-flex items-center gap-1.5 border border-[#c9a84c]/30 bg-[#c9a84c]/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.13em] text-[#e0c76a]">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#e0c76a]" /> Ash is writing
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-xs text-white/35 sm:hidden">{book.chapterCount ?? 0} chapters · {formatDate(book.lastWrittenAt)}</span>
                  </span>
                  <span className="hidden sm:block">
                    <span className="block font-mono text-sm text-white/70">{(book.chapterCount ?? 0).toString().padStart(2, "0")}</span>
                    <span className="mt-1 block text-[9px] uppercase tracking-[0.17em] text-white/30">Chapters</span>
                  </span>
                  <span className="hidden sm:block">
                    <span className="block text-xs text-white/65">{formatDate(book.lastWrittenAt)}</span>
                    <span className="mt-1 block text-[9px] uppercase tracking-[0.17em] text-white/30">Last written</span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-white/25 transition group-hover:translate-x-0.5 group-hover:text-[#e0c76a]" />
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function LoadingBook({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#11100e] text-[#eee8dc]">
      <DetailHeader onBack={onBack} title="Opening book…" status="loading" />
      <div className="grid min-h-0 flex-1 md:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden border-r border-white/[0.07] p-5 md:block">
          <div className="h-4 w-28 animate-pulse bg-white/[0.08]" />
          {[0, 1, 2, 3].map((item) => <div key={item} className="mt-5 h-8 animate-pulse bg-white/[0.045]" />)}
        </aside>
        <main className="mx-auto w-full max-w-3xl p-8 sm:p-12">
          <div className="h-8 w-2/3 animate-pulse bg-white/[0.07]" />
          <div className="mt-10 space-y-3">{[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="h-3 animate-pulse bg-white/[0.04]" style={{ width: `${68 + ((item * 13) % 30)}%` }} />)}</div>
        </main>
      </div>
    </div>
  );
}

function parseQueryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  const details = typeof error === "object" && error !== null
    ? error as { status?: unknown; url?: unknown }
    : {};
  const match = message.match(/^(\d{3}):\s*([\s\S]*)$/);
  return {
    status: typeof details.status === "number" ? String(details.status) : match?.[1] ?? "No HTTP response",
    message: (match?.[2] || message || "The server did not provide an error message").trim(),
    url: typeof details.url === "string" ? details.url : "",
  };
}

function BookLoadError({
  error,
  isFetching,
  onRetry,
  onBack,
}: {
  error: unknown;
  isFetching: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  const detail = parseQueryError(error);
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#11100e] text-[#eee8dc]">
      <DetailHeader onBack={onBack} title="Book unavailable" />
      <main className="flex flex-1 items-center justify-center px-5 py-12">
        <section className="w-full max-w-xl border border-[#9d5d4b]/30 bg-[#9d5d4b]/[0.055] p-6 sm:p-9">
          <div className="mb-5 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-[#dfa58c]">
            <span className="h-2 w-2 rounded-full bg-[#c47a5b]" /> HTTP {detail.status}
          </div>
          <h1 className="font-serif text-3xl text-[#efe2d5]">This page didn’t arrive.</h1>
          <p className="mt-3 text-sm leading-6 text-white/55">The server returned this message:</p>
          <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap break-words border-l border-[#c47a5b]/50 bg-black/20 px-4 py-3 font-mono text-xs leading-5 text-[#e2b5a0]" data-testid="text-book-error-message">{detail.message}</pre>
          {detail.url && <p className="mt-3 break-all font-mono text-[10px] text-white/30">{detail.url}</p>}
          <div className="mt-7 flex flex-wrap gap-3">
            <button onClick={onRetry} disabled={isFetching} className="inline-flex items-center gap-2 border border-[#c9a84c]/35 bg-[#c9a84c]/10 px-4 py-2.5 text-xs uppercase tracking-widest text-[#e0c76a] transition hover:bg-[#c9a84c]/20 disabled:opacity-50" data-testid="button-retry-book">
              {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Retry
            </button>
            <button onClick={onBack} className="border border-white/10 px-4 py-2.5 text-xs uppercase tracking-widest text-white/55 transition hover:bg-white/5 hover:text-white" data-testid="button-error-back-library">Back to library</button>
          </div>
        </section>
      </main>
    </div>
  );
}

function RequestFailure({ error }: { error: unknown }) {
  if (!error) return null;
  const detail = parseQueryError(error);
  return (
    <div className="mx-5 mt-3 border border-[#9d5d4b]/25 bg-[#9d5d4b]/[0.045] px-4 py-3 sm:mx-7" role="alert" data-testid="request-failure">
      <p className="font-mono text-[10px] uppercase tracking-widest text-[#dfa58c]">HTTP {detail.status}</p>
      <p className="mt-1 break-words font-mono text-xs leading-5 text-white/65">{detail.message}</p>
      {detail.url && <p className="mt-1 break-all font-mono text-[10px] text-white/30">{detail.url}</p>}
    </div>
  );
}

function DetailHeader({ onBack, title, status }: { onBack: () => void; title: string; status?: string }) {
  return (
    <header className="shrink-0 border-b border-[#c9a84c]/15 bg-[#11100e] px-4 py-3 sm:px-7">
      <div className="flex min-h-8 items-center gap-3">
        <button onClick={onBack} className="rounded-lg p-2 text-white/45 transition hover:bg-white/5 hover:text-[#e0c76a]" aria-label="Back to library" data-testid="button-back-library">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="h-5 w-px bg-white/10" />
        <Feather className="h-4 w-4 text-[#c9a84c]" />
        <span className="font-serif text-base text-[#e0c76a]">Library</span>
        <ChevronRight className="h-3 w-3 text-white/25" />
        <span className="truncate text-sm text-white/65">{title}</span>
        {status === "loading" && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-[#c9a84c]" />}
      </div>
    </header>
  );
}

function BookWorkspace({
  manuscript,
  chapters,
  activeChapterId,
  onSelectChapter,
  onBack,
}: {
  manuscript: StoryManuscript;
  chapters: StoryChapter[];
  activeChapterId: number | null;
  onSelectChapter: (id: number | null) => void;
  onBack: () => void;
}) {
  const isWriting = manuscript.status === "running";
  const writeStory = useWriteStory(manuscript.id);
  const activeChapter = chapters.find((chapter) => chapter.id === activeChapterId);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#11100e] text-[#eee8dc]">
      <DetailHeader onBack={onBack} title={manuscript.title || "Untitled book"} />
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] bg-[#0e0d0b] px-5 py-2.5 sm:px-7">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isWriting ? "animate-pulse bg-[#e0c76a]" : manuscript.status === "error" ? "bg-[#c47a5b]" : "bg-white/25"}`} />
          <span className={isWriting ? "text-[#e0c76a]" : "truncate text-white/40"}>
            {isWriting ? "Ash is writing this book" : manuscript.status === "incomplete" ? "Writing was interrupted" : manuscript.status === "error" ? "Last writing run stopped" : "At rest"}
          </span>
          {manuscript.lastError && manuscript.status === "error" && <span className="hidden truncate text-[#c47a5b]/70 sm:inline" title={manuscript.lastError}>· {manuscript.lastError}</span>}
        </div>
        <button
          onClick={() => writeStory.mutate()}
          disabled={isWriting || writeStory.isPending}
          className="inline-flex shrink-0 items-center gap-2 border border-[#c9a84c]/30 bg-[#c9a84c]/[0.08] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#e0c76a] transition hover:bg-[#c9a84c]/[0.16] disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="button-write-book"
        >
          {isWriting || writeStory.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {manuscript.status === "incomplete" ? "Continue" : "Write"}
        </button>
      </div>
      {writeStory.isError && <RequestFailure error={writeStory.error} />}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-b border-white/[0.07] bg-[#0e0d0b] md:w-64 md:overflow-y-auto md:border-b-0 md:border-r">
          <div className="hidden px-5 pb-2 pt-6 md:block">
            <div className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[#c9a84c]/55">In this volume</div>
          </div>
          <div className="flex gap-1 overflow-x-auto px-3 py-2 md:flex-col md:overflow-visible md:px-3 md:py-1">
            <button
              onClick={() => onSelectChapter(null)}
              className={`flex shrink-0 items-center gap-3 px-3 py-2.5 text-left text-sm transition md:w-full ${
                activeChapterId === null ? "bg-[#c9a84c]/[0.09] text-[#e0c76a]" : "text-white/55 hover:bg-white/[0.04] hover:text-white/85"
              }`}
              data-testid="button-manuscript-settings"
            >
              <PencilLine className="h-4 w-4 shrink-0" />
              <span className="md:flex-1">Book details</span>
            </button>
            <div className="mx-2 my-1 hidden h-px bg-white/[0.07] md:block" />
            {chapters.map((chapter, index) => (
              <button
                key={chapter.id}
                onClick={() => onSelectChapter(chapter.id)}
                className={`flex max-w-[220px] shrink-0 items-center gap-3 px-3 py-2.5 text-left transition md:max-w-none ${
                  activeChapterId === chapter.id ? "bg-white/[0.07] text-[#e0c76a]" : "text-white/55 hover:bg-white/[0.04] hover:text-white/85"
                }`}
                data-testid={`button-open-chapter-${chapter.id}`}
              >
                <span className="w-5 shrink-0 font-mono text-[10px] text-[#c9a84c]/45">{String(index + 1).padStart(2, "0")}</span>
                <span className="truncate font-serif text-sm">{chapter.title || "Untitled chapter"}</span>
                {chapter.status === "unfinished" && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#d19b5e]" title="Unfinished" />}
              </button>
            ))}
            {chapters.length === 0 && <p className="hidden px-3 py-5 text-xs leading-5 text-white/30 md:block">No chapters have been written yet.</p>}
          </div>
        </aside>
        <main className="min-h-0 flex-1 overflow-y-auto">
          {activeChapter ? (
            <ChapterReader chapter={activeChapter} bookId={manuscript.id} readOnly={isWriting} />
          ) : (
            <ManuscriptEditor manuscript={manuscript} readOnly={isWriting} chapterCount={chapters.length} />
          )}
        </main>
      </div>
    </div>
  );
}

function ManuscriptEditor({
  manuscript,
  readOnly,
  chapterCount,
}: {
  manuscript: StoryManuscript;
  readOnly: boolean;
  chapterCount: number;
}) {
  const updateManuscript = useUpdateManuscript(manuscript.id);
  const [title, setTitle] = useState(manuscript.title || "");
  const [storyPacket, setStoryPacket] = useState(manuscript.storyPacket || "");
  const [summary] = useState(manuscript.summary || "");
  const initializedForId = useRef<string | null>(null);
  const lastSaved = useRef({ title: "", storyPacket: "" });
  const mutateRef = useRef(updateManuscript.mutate);
  mutateRef.current = updateManuscript.mutate;

  useEffect(() => {
    if (initializedForId.current !== manuscript.id) {
      initializedForId.current = manuscript.id;
      const nextTitle = manuscript.title || "";
      const nextPacket = manuscript.storyPacket || "";
      setTitle(nextTitle);
      setStoryPacket(nextPacket);
      lastSaved.current = { title: nextTitle, storyPacket: nextPacket };
    }
  }, [manuscript.id, manuscript.title, manuscript.storyPacket]);

  useEffect(() => {
    if (initializedForId.current !== manuscript.id || readOnly) return;
    const timer = window.setTimeout(() => {
      if (title !== lastSaved.current.title || storyPacket !== lastSaved.current.storyPacket) {
        lastSaved.current = { title, storyPacket };
        mutateRef.current({ title, storyPacket });
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [title, storyPacket, readOnly, manuscript.id]);

  return (
    <div className="mx-auto w-full max-w-4xl px-5 pb-16 pt-8 sm:px-10 sm:pt-12">
      <div className="mb-8 border-b border-[#c9a84c]/15 pb-7">
        <div className="mb-3 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.22em] text-[#c9a84c]/60">
          <Sparkles className="h-3 w-3" /> Manuscript
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-serif text-4xl tracking-[-0.03em] text-[#efe6d5] sm:text-5xl">{manuscript.title || "Untitled book"}</h1>
            <p className="mt-2 text-xs text-white/38">{chapterCount} {chapterCount === 1 ? "chapter" : "chapters"} · Book details and story packet</p>
          </div>
          <SaveIndicator saving={updateManuscript.isPending} />
        </div>
        {readOnly && <p className="mt-4 inline-flex items-center gap-2 text-xs text-[#d8bd70]"><span className="h-1.5 w-1.5 rounded-full bg-[#d8bd70]" /> Ash is writing; edits are paused until he’s done.</p>}
      </div>
      <RequestFailure error={updateManuscript.error} />

      <div className="space-y-9">
        <section>
          <label htmlFor="book-title" className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[#c9a84c]/70">Book title</label>
          <input
            id="book-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            readOnly={readOnly}
            placeholder="Name this book"
            className="w-full border border-white/[0.09] bg-[#171512] px-4 py-3 font-serif text-xl text-[#efe6d5] outline-none transition placeholder:text-white/20 focus:border-[#c9a84c]/45 read-only:opacity-65"
            data-testid="input-book-title"
          />
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label htmlFor="story-packet" className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#c9a84c]/70">Story packet</label>
            <SaveIndicator saving={updateManuscript.isPending} compact />
          </div>
          <p className="mb-4 max-w-2xl text-xs leading-5 text-white/38">The premise, cast, and guiding notes Ash uses to keep the story on course.</p>
          <textarea
            id="story-packet"
            value={storyPacket}
            onChange={(event) => setStoryPacket(event.target.value)}
            readOnly={readOnly}
            spellCheck={false}
            placeholder="The world, its people, and where this story is headed…"
            className="min-h-[300px] w-full resize-y border border-white/[0.09] bg-[#0c0b09] px-5 py-4 font-mono text-[13px] leading-6 text-white/75 outline-none transition placeholder:text-white/20 focus:border-[#c9a84c]/40 read-only:opacity-65 sm:min-h-[360px]"
            data-testid="input-story-packet"
          />
        </section>

        {summary && (
          <section>
            <label htmlFor="book-summary" className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">Story so far</label>
            <textarea id="book-summary" value={summary} readOnly className="min-h-36 w-full resize-y border border-white/[0.06] bg-white/[0.018] px-5 py-4 font-serif text-sm leading-7 text-white/50 outline-none" data-testid="text-book-summary" />
          </section>
        )}
      </div>
    </div>
  );
}

function SaveIndicator({ saving, compact = false }: { saving: boolean; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.13em] ${saving ? "text-[#d8bd70]" : "text-white/30"}`} aria-live="polite">
      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
      {saving ? "Saving" : compact ? "Auto-save" : "Changes save automatically"}
    </span>
  );
}

function ChapterReader({ chapter, bookId, readOnly }: { chapter: StoryChapter; bookId: string; readOnly: boolean }) {
  const updateChapter = useUpdateChapter(bookId);
  const [title, setTitle] = useState(chapter.title || "");
  const [content, setContent] = useState(chapter.content || "");
  const initializedForId = useRef<number | null>(null);
  const lastSaved = useRef({ title: "", content: "" });
  const mutateRef = useRef(updateChapter.mutate);
  mutateRef.current = updateChapter.mutate;

  useEffect(() => {
    if (initializedForId.current !== chapter.id) {
      initializedForId.current = chapter.id;
      const nextTitle = chapter.title || "";
      const nextContent = chapter.content || "";
      setTitle(nextTitle);
      setContent(nextContent);
      lastSaved.current = { title: nextTitle, content: nextContent };
    }
  }, [chapter.id, chapter.title, chapter.content]);

  useEffect(() => {
    if (initializedForId.current !== chapter.id || readOnly) return;
    const timer = window.setTimeout(() => {
      if (title !== lastSaved.current.title || content !== lastSaved.current.content) {
        lastSaved.current = { title, content };
        mutateRef.current({ id: chapter.id, data: { title, content } });
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [title, content, chapter.id, readOnly]);

  return (
    <article className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-5 pb-16 pt-8 sm:px-10 sm:pt-12">
      <div className="mb-8 border-b border-[#c9a84c]/15 pb-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[#c9a84c]/60">Chapter {String(chapter.position).padStart(2, "0")}</span>
          <SaveIndicator saving={updateChapter.isPending} />
        </div>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          readOnly={readOnly}
          placeholder="Untitled chapter"
          aria-label="Chapter title"
          className="w-full border-0 bg-transparent p-0 font-serif text-3xl tracking-[-0.025em] text-[#efe6d5] outline-none placeholder:text-white/20 focus:ring-0 sm:text-4xl read-only:opacity-70"
          data-testid={`input-chapter-title-${chapter.id}`}
        />
        {chapter.status === "unfinished" && <span className="mt-3 inline-block border border-[#d19b5e]/30 bg-[#d19b5e]/[0.08] px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-[#d8aa70]">Unfinished</span>}
      </div>
      <RequestFailure error={updateChapter.error} />
      {chapter.continuation && (
        <aside className="mb-8 border-l-2 border-[#c9a84c]/45 bg-[#c9a84c]/[0.045] px-5 py-4">
          <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-[#c9a84c]/65">Continuation note</div>
          <p className="whitespace-pre-wrap font-mono text-xs leading-5 text-[#d9c79d]/75">{chapter.continuation}</p>
        </aside>
      )}
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        readOnly={readOnly}
        spellCheck={false}
        placeholder="The chapter is waiting for its first line."
        aria-label="Chapter text"
        className="min-h-[60vh] w-full flex-1 resize-y border-0 bg-transparent p-0 font-serif text-[16px] leading-[1.95] text-[#e7dfd2]/85 outline-none placeholder:text-white/20 focus:ring-0 sm:text-[18px] read-only:opacity-80"
        data-testid={`input-chapter-content-${chapter.id}`}
      />
      {readOnly && <p className="mt-6 text-xs text-[#d8bd70]">Editing is paused while Ash is writing.</p>}
    </article>
  );
}
