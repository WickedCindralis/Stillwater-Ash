import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileText, RefreshCw } from "lucide-react";
import { Link } from "wouter";

type PacketMessage = {
  role: "developer" | "assistant" | "user";
  content: unknown;
  name?: string;
};

type PacketResponse = {
  generatedAt: string;
  historyIncluded: false;
  messages: PacketMessage[];
};

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content, null, 2);
}

function roleLabel(role: PacketMessage["role"]): string {
  return role === "developer" ? "DEVELOPER" : role === "assistant" ? "ASSISTANT" : "USER";
}

export default function PacketPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<PacketResponse>({
    queryKey: ["/api/packet-preview"],
  });

  return (
    <div className="min-h-full bg-[#080706] text-white/90">
      <header className="sticky top-0 z-10 border-b border-gold/20 bg-black/95 px-4 py-3 backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/persona"
              className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/5 hover:text-gold"
              title="Back to Persona"
              data-testid="link-back-persona"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <FileText className="h-5 w-5 text-gold" />
            <div>
              <h1 className="font-serif text-xl text-gold">Ash API Packet</h1>
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">
                Exact assembly order · message history omitted
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition-colors hover:border-gold/40 hover:text-gold disabled:cursor-wait disabled:opacity-50"
            data-testid="button-refresh-packet"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
        {isLoading && (
          <div className="rounded-xl border border-gold/20 bg-[#15110d] p-10 text-center font-serif text-lg text-gold/70">
            Assembling the live packet...
          </div>
        )}

        {isError && (
          <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-6 text-center text-sm text-red-200">
            The packet could not be assembled. Refresh to try again.
          </div>
        )}

        {data && (
          <article className="overflow-hidden rounded-sm border border-[#c6b99f]/60 bg-[#e8dfcd] text-[#211b16] shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
            <div className="border-b border-[#8f8068]/35 px-6 py-8 sm:px-12">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.25em] text-[#78694f]">
                    STILLWATER / INTERNAL DOCUMENT
                  </p>
                  <h2 className="font-serif text-3xl text-[#2e251b] sm:text-4xl">Ash Cindralis</h2>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#665946]">
                    The exact ordered message packet assembled immediately before an API call.
                    This view uses the live persona and operational state, with conversation history intentionally left out.
                  </p>
                </div>
                <div className="rounded border border-[#a99a7e]/50 bg-[#f2eadc]/70 px-4 py-3 text-right text-[11px] text-[#756650]">
                  <div className="font-bold uppercase tracking-[0.16em] text-[#574a38]">
                    {data.messages.length} packet entries
                  </div>
                  <div className="mt-1">History: omitted</div>
                  <div>{new Date(data.generatedAt).toLocaleString()}</div>
                </div>
              </div>
            </div>

            <div className="space-y-5 px-4 py-6 sm:px-12 sm:py-10">
              {data.messages.map((message, index) => (
                <section
                  key={`${index}-${message.role}`}
                  className="overflow-hidden rounded border border-[#b7a98f]/70 bg-[#f5eee2]/80"
                  data-testid={`packet-entry-${index + 1}`}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#c8bca7]/70 bg-[#ded2bd]/55 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#6e604c]">
                    <span className="text-[#9a7b36]">{String(index + 1).padStart(2, "0")}</span>
                    <span>{roleLabel(message.role)}</span>
                    {message.name && <span className="font-normal tracking-[0.08em] text-[#88785f]">/ {message.name}</span>}
                  </div>
                  <pre className="whitespace-pre-wrap break-words px-4 py-4 font-mono text-[12px] leading-6 text-[#2d261d] sm:px-5">
                    {messageText(message.content)}
                  </pre>
                </section>
              ))}
            </div>

            <footer className="border-t border-[#8f8068]/35 px-6 py-5 text-xs leading-relaxed text-[#756650] sm:px-12">
              This document is generated from the same packet assembly path used by Ash's API calls.
              It is a read-only inspection view; refreshing rebuilds it from the current database-backed persona and state.
            </footer>
          </article>
        )}
      </main>
    </div>
  );
}