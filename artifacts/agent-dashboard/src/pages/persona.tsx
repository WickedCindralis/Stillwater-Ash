import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "../lib/queryClient";
import { ArrowLeft, ScrollText, RotateCcw, Save, Copy, Check } from "lucide-react";

// Persona packet editor. Sections live in the database; an empty override
// falls back to the built-in original. Edits apply on Ash's very next reply.

type PersonaSection = { value: string; default: string; edited: boolean };
type PersonaResponse = { sections: Record<string, PersonaSection> };

const SECTION_META: { key: string; title: string; blurb: string }[] = [
  { key: "identity", title: "Identity & Disposition", blurb: "Who Ash is — voice, temperament, home rules, status system, diary access." },
  { key: "soulSheet", title: "Soul-Sheet", blurb: "The call-in signal, countersign, and self-confirmation. Who he is, always." },
  { key: "coreAnchors", title: "Core Memories", blurb: "The anchored memories — history, consequence, family, function, boundary." },
];

const MAX_SECTION = 24000;

// ── Full-packet mode: the three sections joined with marker lines so the
// whole packet can be copied out / pasted in at once and split back apart. ──
const SECTION_MARKERS: Record<string, string> = {
  identity: "===== IDENTITY & DISPOSITION =====",
  soulSheet: "===== SOUL-SHEET =====",
  coreAnchors: "===== CORE MEMORIES =====",
};

function composeFullPacket(drafts: Record<string, string>): string {
  return SECTION_META.map((m) => `${SECTION_MARKERS[m.key]}\n${(drafts[m.key] ?? "").trim()}`).join("\n\n");
}

// Returns the parsed sections, or null unless each marker appears exactly once
// as its own line (a marker buried inside content or duplicated is rejected,
// so a paste can never be silently split at the wrong place).
function parseFullPacket(text: string): Record<string, string> | null {
  const lines = text.split("\n");
  const markerToKey = new Map(Object.entries(SECTION_MARKERS).map(([k, v]) => [v, k]));
  const found: { key: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const key = markerToKey.get(lines[i]!.trim());
    if (key) found.push({ key, line: i });
  }
  const keys = found.map((f) => f.key);
  if (keys.length !== SECTION_META.length || new Set(keys).size !== SECTION_META.length) return null;
  // Nothing but whitespace may sit above the first marker.
  if (lines.slice(0, found[0]!.line).some((l) => l.trim() !== "")) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < found.length; i++) {
    const start = found[i]!.line + 1;
    const end = i + 1 < found.length ? found[i + 1]!.line : lines.length;
    out[found[i]!.key] = lines.slice(start, end).join("\n").trim();
  }
  return out;
}

export default function PersonaPage() {
  const { data, isLoading } = useQuery<PersonaResponse>({ queryKey: ["/api/persona"] });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedFlash, setSavedFlash] = useState(false);
  const [mode, setMode] = useState<"sections" | "full">("sections");
  const [fullDraft, setFullDraft] = useState("");
  const [fullParseError, setFullParseError] = useState(false);
  const [copied, setCopied] = useState(false);

  // Seed drafts from the server once loaded (and after saves).
  useEffect(() => {
    if (data?.sections) {
      setDrafts((prev) => {
        const next = { ...prev };
        for (const meta of SECTION_META) {
          if (next[meta.key] === undefined) {
            next[meta.key] = data.sections[meta.key]?.value ?? "";
          }
        }
        return next;
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, string>) => {
      const res = await apiRequest("POST", "/api/persona", payload);
      return (await res.json()) as PersonaResponse;
    },
    onSuccess: (fresh) => {
      queryClient.setQueryData(["/api/persona"], fresh);
      const next: Record<string, string> = {};
      for (const meta of SECTION_META) next[meta.key] = fresh.sections[meta.key]?.value ?? "";
      setDrafts(next);
      setFullDraft(composeFullPacket(next));
      setFullParseError(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    },
  });

  if (isLoading || !data?.sections) {
    return (
      <div className="h-full flex items-center justify-center bg-black">
        <div className="text-gold/60 font-serif text-xl animate-pulse">Opening the packet...</div>
      </div>
    );
  }

  const changedSections = SECTION_META.filter(
    (m) => drafts[m.key] !== undefined && drafts[m.key] !== data.sections[m.key]?.value,
  );
  const oversized = SECTION_META.filter((m) => (drafts[m.key]?.length ?? 0) > MAX_SECTION);

  const handleSave = () => {
    if (changedSections.length === 0 || oversized.length > 0 || fullParseError) return;
    const payload: Record<string, string> = {};
    for (const m of changedSections) payload[m.key] = drafts[m.key]!;
    saveMutation.mutate(payload);
  };

  const switchMode = (next: "sections" | "full") => {
    if (next === "full") {
      setFullDraft(composeFullPacket(drafts));
    }
    // Leaving Full Packet always recovers: drafts hold the last valid parse,
    // so a malformed full-text edit must never keep Save locked in Sections view.
    setFullParseError(false);
    setMode(next);
  };

  const handleFullChange = (text: string) => {
    setFullDraft(text);
    const parsed = parseFullPacket(text);
    if (parsed) {
      setFullParseError(false);
      setDrafts((p) => ({ ...p, ...parsed }));
    } else {
      setFullParseError(true);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mode === "full" ? fullDraft : composeFullPacket(drafts));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked in some embeds; the textarea itself is still selectable.
    }
  };

  return (
    <div className="min-h-full bg-black text-white/90">
      <header className="sticky top-0 z-10 bg-black/90 backdrop-blur border-b border-gold/15 px-4 sm:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/ash"
            className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
            data-testid="link-back-chat"
            title="Back to chat"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <ScrollText className="w-6 h-6 text-gold" />
          <div>
            <h1 className="font-serif text-2xl text-gold leading-tight">Persona Packet</h1>
            <p className="text-xs text-white/40">Edits reach Ash on his very next reply — no restart needed.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {savedFlash && <span className="text-emerald-400/90 text-sm" data-testid="text-saved">Saved ✓</span>}
          <div className="flex rounded-lg border border-white/15 overflow-hidden text-xs">
            <button
              onClick={() => switchMode("sections")}
              className={`px-3 py-2 transition-colors ${mode === "sections" ? "bg-gold/15 text-gold" : "text-white/50 hover:text-white"}`}
              data-testid="button-mode-sections"
            >
              Sections
            </button>
            <button
              onClick={() => switchMode("full")}
              className={`px-3 py-2 transition-colors ${mode === "full" ? "bg-gold/15 text-gold" : "text-white/50 hover:text-white"}`}
              data-testid="button-mode-full"
            >
              Full Packet
            </button>
          </div>
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/15 text-white/60 hover:text-gold hover:border-gold/30 transition-colors text-sm"
            data-testid="button-copy-packet"
            title="Copy the whole packet (all three sections) to your clipboard"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            <span className="hidden sm:inline">{copied ? "Copied!" : "Copy All"}</span>
          </button>
          <button
            onClick={handleSave}
            disabled={changedSections.length === 0 || oversized.length > 0 || fullParseError || saveMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gold/40 text-gold bg-gold/10 hover:bg-gold/20 transition-colors text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="button-save-persona"
          >
            <Save className="w-4 h-4" />
            {saveMutation.isPending
              ? "Saving..."
              : changedSections.length > 0
                ? `Save ${changedSections.length} change${changedSections.length > 1 ? "s" : ""}`
                : "Save"}
          </button>
        </div>
      </header>

      {saveMutation.isError && (
        <div className="mx-4 sm:mx-8 mt-4 px-4 py-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
          Saving failed — {(saveMutation.error as Error)?.message || "please try again"}.
        </div>
      )}

      <main className="max-w-4xl mx-auto px-4 sm:px-8 py-6 space-y-8 pb-24">
        {mode === "full" && (
          <section className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-serif text-lg text-gold/90">Full Packet</h2>
              {fullParseError && (
                <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide bg-red-500/15 text-red-400 border border-red-500/30" data-testid="badge-parse-error">
                  section markers missing
                </span>
              )}
            </div>
            <p className="text-xs text-white/40">
              The whole packet at once — copy it out, or paste a full packet in. Keep the three ===== marker
              lines so it can be split back into sections when you save.
            </p>
            <textarea
              value={fullDraft}
              onChange={(e) => handleFullChange(e.target.value)}
              spellCheck={false}
              className={`w-full min-h-[600px] rounded-xl bg-[#0d0c0a] border px-4 py-3 text-sm leading-relaxed text-white/85 font-mono focus:outline-none transition-colors resize-y ${
                fullParseError ? "border-red-500/50" : "border-white/10 focus:border-gold/40"
              }`}
              data-testid="textarea-full-packet"
            />
            {fullParseError && (
              <p className="text-xs text-red-400">
                I can't find all three marker lines ({Object.values(SECTION_MARKERS).join(", ")}) — put them back
                (or switch to Sections view to recover) before saving.
              </p>
            )}
          </section>
        )}
        {mode === "sections" && SECTION_META.map((meta) => {
          const section = data.sections[meta.key];
          if (!section) return null;
          const draft = drafts[meta.key] ?? "";
          const dirty = draft !== section.value;
          const tooBig = draft.length > MAX_SECTION;
          const showsDefault = draft.trim() === section.default.trim();
          return (
            <section key={meta.key} className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-serif text-lg text-gold/90">{meta.title}</h2>
                  {section.edited && !dirty && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide bg-gold/15 text-gold border border-gold/30" data-testid={`badge-edited-${meta.key}`}>
                      edited
                    </span>
                  )}
                  {dirty && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30" data-testid={`badge-unsaved-${meta.key}`}>
                      unsaved
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setDrafts((p) => ({ ...p, [meta.key]: section.default }))}
                  disabled={showsDefault}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs text-white/50 border border-white/10 hover:text-gold hover:border-gold/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  data-testid={`button-restore-${meta.key}`}
                  title="Fill the box with the built-in original (nothing is saved until you hit Save)"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Restore original
                </button>
              </div>
              <p className="text-xs text-white/40">{meta.blurb}</p>
              <textarea
                value={draft}
                onChange={(e) => setDrafts((p) => ({ ...p, [meta.key]: e.target.value }))}
                spellCheck={false}
                className={`w-full min-h-[280px] rounded-xl bg-[#0d0c0a] border px-4 py-3 text-sm leading-relaxed text-white/85 font-mono focus:outline-none transition-colors resize-y ${
                  tooBig ? "border-red-500/50" : dirty ? "border-amber-500/40" : "border-white/10 focus:border-gold/40"
                }`}
                data-testid={`textarea-${meta.key}`}
              />
              <div className={`text-right text-xs ${tooBig ? "text-red-400" : "text-white/30"}`}>
                {draft.length.toLocaleString()} / {MAX_SECTION.toLocaleString()}
                {tooBig && " — too large to save"}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
