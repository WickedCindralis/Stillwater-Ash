import { useState, useRef, useEffect, useCallback, type ClipboardEvent } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AshMessage, AshState } from "@/lib/types";

type SendMessageResponse = {
  wickedMessage: AshMessage;
  ashMessage: AshMessage | null;
};

function mergeLatestMessages(
  current: AshMessage[] | undefined,
  incoming: Array<AshMessage | null>,
): AshMessage[] {
  const byId = new Map((current ?? []).map((message) => [message.id, message]));
  for (const message of incoming) {
    if (message) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}
import {
  Send, Loader2, ImagePlus, Wand2, X, ArrowLeft, Swords, CircleDot,
  Volume2, VolumeX,
} from "lucide-react";
import ChessPanel from "@/components/chess-panel";
import Connect4Panel from "@/components/connect4-panel";
import throneDamask from "@/assets/throne-damask.jpg";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// The date lives in a per-day divider above the messages; each bubble keeps
// only the direction + time of day.
function messageStamp(m: AshMessage): string {
  const who = m.role === "wicked" ? "Wicked→Ash_Cindralis" : "Ash_Cindralis→Wicked";
  if (!m.createdAt) return who;
  const stamp = new Date(m.createdAt).toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${who} ${stamp}`;
}

// Day divider label, e.g. "Aug 18 26" (Eastern).
function dayStamp(m: AshMessage): string {
  if (!m.createdAt) return "";
  return new Date(m.createdAt)
    .toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "2-digit",
    })
    .replace(/,/g, "");
}

export default function CellPage() {
  const [message, setMessage] = useState("");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState(false);
  const [showChess, setShowChess] = useState(false);
  const [showConnect4, setShowConnect4] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Ash's voice (ElevenLabs TTS) ──
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsError, setTtsError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSpokenIdRef = useRef<number | null>(null);
  // Each speak() call gets a generation number + abort controller; only the
  // newest generation may create audio or touch playback state.
  const ttsGenRef = useRef(0);
  const ttsAbortRef = useRef<AbortController | null>(null);

  const stopSpeaking = useCallback(() => {
    ttsGenRef.current += 1; // invalidate any in-flight speak()
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      try { audio.pause(); } catch { /* noop */ }
      if (audio.src.startsWith("blob:")) { try { URL.revokeObjectURL(audio.src); } catch { /* noop */ } }
      audioRef.current = null;
    }
    setTtsPlaying(false);
  }, []);

  // Stop speech (and abort the request) when leaving the page.
  useEffect(() => stopSpeaking, [stopSpeaking]);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;
    stopSpeaking();
    setTtsError("");
    const gen = ttsGenRef.current;
    const alive = () => ttsGenRef.current === gen;
    const abort = new AbortController();
    ttsAbortRef.current = abort;
    setTtsPlaying(true);
    const cleanup = (url?: string) => {
      if (url) { try { URL.revokeObjectURL(url); } catch { /* noop */ } }
      if (!alive()) return;
      setTtsPlaying(false);
      audioRef.current = null;
    };
    try {
      const res = await apiRequest("POST", "/api/tts", { text: text.substring(0, 5000) });
      if (!alive()) { abort.abort(); return; }
      const MS = (window as unknown as { ManagedMediaSource?: typeof MediaSource }).ManagedMediaSource || window.MediaSource;
      const canStream = MS && typeof MS.isTypeSupported === "function" && MS.isTypeSupported("audio/mpeg") && res.body;

      if (canStream) {
        // Streaming playback — audio starts on the first chunk
        const mediaSource = new MS();
        const audio = new Audio();
        (audio as unknown as { disableRemotePlayback?: boolean }).disableRemotePlayback = true;
        const objUrl = URL.createObjectURL(mediaSource);
        audio.src = objUrl;
        audioRef.current = audio;
        audio.onended = () => cleanup(objUrl);
        audio.onerror = () => cleanup(objUrl);
        mediaSource.addEventListener("sourceopen", async () => {
          const reader = res.body!.getReader();
          try {
            const sb = mediaSource.addSourceBuffer("audio/mpeg");
            const waitForIdle = () =>
              new Promise<void>((resolve) => {
                if (!sb.updating) { resolve(); return; }
                sb.addEventListener("updateend", () => resolve(), { once: true });
              });
            let started = false;
            for (;;) {
              const { value, done } = await reader.read();
              if (!alive()) { try { reader.cancel(); } catch { /* noop */ } break; }
              if (done) {
                await waitForIdle();
                try { mediaSource.endOfStream(); } catch { /* noop */ }
                break;
              }
              // Backpressure: append one chunk at a time, waiting for the
              // SourceBuffer to finish before reading more.
              await waitForIdle();
              if (!alive()) { try { reader.cancel(); } catch { /* noop */ } break; }
              sb.appendBuffer(value as BufferSource);
              if (!started) {
                audio.play().catch(() => {});
                started = true;
              }
            }
          } catch {
            try { reader.cancel(); } catch { /* noop */ }
            try { audio.pause(); } catch { /* noop */ }
            cleanup(objUrl);
          }
        }, { once: true });
      } else {
        // Fallback: whole-blob playback
        const blob = await res.blob();
        if (!alive()) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => cleanup(url);
        audio.onerror = () => cleanup(url);
        try { await audio.play(); } catch { cleanup(url); }
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const serverMessage = raw.match(/"error"\s*:\s*"([^"]+)"/)?.[1];
      setTtsError(serverMessage || "Ash’s voice could not be played.");
      cleanup();
    }
  }, [stopSpeaking]);

  const { data: state } = useQuery<AshState>({
    queryKey: ["/api/state"],
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });
  const { data: messages = [] } = useQuery<AshMessage[]>({
    queryKey: ["/api/messages"],
    refetchInterval: 8_000,
    refetchIntervalInBackground: true,
  });
  // Older history is loaded on demand; no messages are removed from storage.
  const [olderMessages, setOlderMessages] = useState<AshMessage[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const allMessages = (() => {
    const seen = new Set<number>();
    const merged: AshMessage[] = [];
    for (const m of [...olderMessages, ...messages]) {
      if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
    }
    return merged.sort((a, b) => a.id - b.id);
  })();
  const loadOlder = async () => {
    const oldest = allMessages[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await apiRequest("GET", `/api/messages?before=${oldest.id}`);
      const page: AshMessage[] = await res.json();
      if (page.length === 0) setHasMoreHistory(false);
      setOlderMessages((prev) => [...page, ...prev]);
    } finally {
      setLoadingOlder(false);
    }
  };

  const sendMutation = useMutation({
    mutationFn: async (payload: { content: string; imageDataUrl?: string; requestImage: boolean }) => {
      const response = await apiRequest("POST", "/api/messages", payload);
      return (await response.json()) as SendMessageResponse;
    },
    onSuccess: ({ wickedMessage, ashMessage }) => {
      queryClient.setQueryData<AshMessage[]>(["/api/messages"], (current) =>
        mergeLatestMessages(current, [wickedMessage, ashMessage]),
      );
    },
  });

  const latestMessageId = allMessages[allMessages.length - 1]?.id ?? 0;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [latestMessageId, sendMutation.isPending]);

  // Auto-speak new Ash replies while the voice toggle is on.
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1]!;
    if (lastSpokenIdRef.current === null) {
      // First load — don't speak history, just remember where we are.
      lastSpokenIdRef.current = last.id;
      return;
    }
    if (ttsEnabled && last.role === "ash" && last.content && last.id !== lastSpokenIdRef.current) {
      lastSpokenIdRef.current = last.id;
      speak(last.content);
    } else if (last.id > (lastSpokenIdRef.current ?? 0)) {
      lastSpokenIdRef.current = last.id;
    }
  }, [messages, ttsEnabled, speak]);

  // Stop any playback when the voice toggle is switched off.
  useEffect(() => {
    if (!ttsEnabled) stopSpeaking();
  }, [ttsEnabled, stopSpeaking]);

  const handleSend = () => {
    const content = message.trim();
    if (!content && !pendingImage) return;
    sendMutation.mutate({
      content,
      imageDataUrl: pendingImage || undefined,
      requestImage: imageMode,
    });
    setMessage("");
    setPendingImage(null);
    setImageMode(false);
    if (inputRef.current) inputRef.current.style.height = "auto";
  };

  const handleImagePick = async (file?: File | null) => {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      alert("Image exceeds the 12MB limit");
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setPendingImage(dataUrl);
  };

  const handleImagePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItem = Array.from(event.clipboardData.items)
      .find((item) => item.kind === "file" && item.type.startsWith("image/"));
    const imageFile = imageItem?.getAsFile();
    if (!imageFile) return;
    event.preventDefault();
    void handleImagePick(imageFile);
  };

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Header */}
      <header className="flex items-center justify-between px-3 py-2.5 border-b border-white/10 bg-black">
        <div className="flex items-center gap-2">
          <Link href="/" className="p-1.5 text-white/50 hover:text-white" data-testid="link-back">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-serif text-xl text-gold leading-tight" data-testid="text-cell-title">Ash</h1>
            <span className="text-lg text-white/40 leading-tight">{state?.status || "..."}</span>
          </div>
        </div>
        <div className="flex items-center">
          <button
            onClick={() => setTtsEnabled((v) => !v)}
            className={`p-2 rounded-lg transition-colors ${
              ttsEnabled
                ? `text-gold bg-gold/10 hover:bg-gold/20 ${ttsPlaying ? "animate-pulse" : ""}`
                : "text-white/50 hover:text-gold hover:bg-white/5"
            }`}
            data-testid="button-cell-tts"
            title={ttsEnabled ? "Ash's voice ON" : "Ash's voice OFF"}
          >
            {ttsEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>
          <button
            onClick={() => setShowChess(true)}
            className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
            data-testid="button-cell-chess"
            title="Chess with Ash"
          >
            <Swords className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowConnect4(true)}
            className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
            data-testid="button-cell-connect4"
            title="Connect Four with Ash"
          >
            <CircleDot className="w-5 h-5" />
          </button>
        </div>
      </header>

      {ttsError && (
        <div
          className="border-b border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-300"
          data-testid="text-cell-tts-error"
        >
          {ttsError}
        </div>
      )}

      {showChess && <ChessPanel onClose={() => setShowChess(false)} />}
      {showConnect4 && <Connect4Panel onClose={() => setShowConnect4(false)} />}

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5"
        style={{
          backgroundImage: `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.55)), url(${throneDamask})`,
          backgroundSize: "auto, 600px auto",
          backgroundRepeat: "repeat",
        }}
      >
        {messages.length >= 300 && hasMoreHistory && (
          <div className="text-center py-1">
            <button
              onClick={loadOlder}
              disabled={loadingOlder}
              className="px-4 py-1.5 rounded-full text-sm text-gold/70 hover:text-gold bg-white/5 border border-white/10 hover:border-gold/30 transition-colors disabled:opacity-50"
              data-testid="button-cell-load-older"
            >
              {loadingOlder ? "Fetching the archives..." : "↑ Load earlier messages"}
            </button>
          </div>
        )}
        {allMessages.map((m, i) => (
          <div key={m.id}>
            {(i === 0 || dayStamp(allMessages[i - 1]!) !== dayStamp(m)) && dayStamp(m) && (
              <div className="flex items-center gap-3 py-1.5" data-testid={`day-divider-cell-${m.id}`}>
                <div className="flex-1 h-px bg-gold/15" />
                <span className="text-xs text-gold/60 font-serif tracking-wide">{dayStamp(m)}</span>
                <div className="flex-1 h-px bg-gold/15" />
              </div>
            )}
          <div className={`flex ${m.role === "wicked" ? "justify-end" : "justify-start"}`} data-testid={`cell-message-${m.id}`}>
            <div
              className={`max-w-[82%] rounded-2xl px-3.5 py-2 ${
                m.role === "wicked"
                  ? "bg-gold/15 border border-gold/25 text-white"
                  : m.source === "self_prompt"
                  ? "bg-ember/10 border border-ember/30 text-white/90"
                  : "bg-white/8 border border-white/10 text-white/90"
              }`}
            >
              <div className="text-[10px] text-white/30 mb-1" data-testid={`stamp-cell-${m.id}`}>
                {messageStamp(m)}
              </div>
              {m.source === "self_prompt" && (
                <div className="text-lg uppercase tracking-wider text-ember/80 mb-0.5">Reflection</div>
              )}
              {m.imageUrl && (
                <img src={m.imageUrl} alt="shared" className="rounded-lg mb-1.5 max-h-64" data-testid={`img-cell-${m.id}`} />
              )}
              {m.content && <p className="whitespace-pre-wrap text-lg leading-relaxed">{m.content}</p>}
            </div>
          </div>
          </div>
        ))}
        {sendMutation.isPending && (
          <div className="flex justify-start">
            <div className="bg-white/8 border border-white/10 rounded-2xl px-3.5 py-2.5 flex items-center gap-2 text-white/50">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-lg font-serif italic">Ash is thinking...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-white/10 bg-black px-3 py-2.5">
        {pendingImage && (
          <div className="relative inline-block mb-2">
            <img src={pendingImage} alt="attached" className="max-h-28 rounded-lg border border-white/20" data-testid="img-cell-pending" />
            <button
              onClick={() => setPendingImage(null)}
              className="absolute -top-2 -right-2 bg-black/80 border border-white/30 rounded-full p-0.5 text-white/80 hover:text-white"
              data-testid="button-cell-remove-image"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { handleImagePick(e.target.files?.[0]); e.target.value = ""; }}
            data-testid="input-cell-file"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-xl bg-white/10 text-white/60 hover:text-white hover:bg-white/20 transition-colors"
            data-testid="button-cell-attach"
            title="Attach image or paste one into the message box"
          >
            <ImagePlus className="w-5 h-5" />
          </button>
          <button
            onClick={() => setImageMode((v) => !v)}
            className={`p-2.5 rounded-xl transition-colors ${
              imageMode
                ? "bg-amber-500/30 text-amber-300 hover:bg-amber-500/40"
                : "bg-white/10 text-white/60 hover:text-white hover:bg-white/20"
            }`}
            data-testid="button-cell-picture-mode"
            title={imageMode ? "Picture mode ON" : "Picture mode OFF"}
          >
            <Wand2 className="w-5 h-5" />
          </button>
          <textarea
            ref={inputRef}
            value={message}
            onPaste={handleImagePaste}
            onChange={(e) => {
              setMessage(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Message Ash… or paste a picture"
            rows={1}
            className="flex-1 bg-white/10 text-white placeholder-white/30 rounded-xl px-4 py-2.5 resize-none outline-none border border-white/10 focus:border-white/30"
            style={{ fontSize: "1.125rem", maxHeight: 120 }}
            data-testid="input-cell-message"
          />
          <button
            onClick={handleSend}
            disabled={(!message.trim() && !pendingImage) || sendMutation.isPending}
            className="p-2.5 rounded-xl bg-white/10 text-white/60 hover:text-white hover:bg-white/20 transition-colors disabled:text-white/15 disabled:bg-white/5"
            data-testid="button-cell-send"
          >
            {sendMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
