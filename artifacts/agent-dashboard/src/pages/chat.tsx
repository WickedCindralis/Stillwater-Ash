import { useState, useRef, useEffect, type ClipboardEvent } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getClipboardImage } from "@/lib/clipboardImage";
import type { AshMessage, AshState, AshDiaryEntry } from "@/lib/types";
import {
  Flame, Send, Loader2, ImagePlus, Wand2, X, BookOpen, Settings, Monitor, Copy,
  Smartphone, LogOut, Power, Trash2, ArrowLeft, Swords, CircleDot, Download, ScrollText, Megaphone, Feather, RefreshCw, QrCode,
} from "lucide-react";
import { SiDiscord } from "react-icons/si";
import ChessPanel from "@/components/chess-panel";
import throneDamask from "@/assets/throne-damask.jpg";
import Connect4Panel from "@/components/connect4-panel";

type SendMessageResponse = {
  wickedMessage: AshMessage;
  ashMessage: AshMessage | null;
};

type HangoutStatus = {
  status: "idle" | "inviting" | "active";
  sessionId: string;
  connected: boolean;
  companionPaired: boolean;
  lastError: string;
  lastCaptureAt: string | null;
};

type LovenseStatus = {
  configured: boolean;
  connected: boolean;
  qrUrl: string | null;
  expiresAt: string | null;
  callbackUrl: string;
  stopWarning?: string | null;
  previewOnly?: boolean;
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

const STATUS_LABELS: Record<string, string> = {
  alert: "Searching",
  standby: "Guarding",
  online: "At Ease",
  busy: "Busy",
  dnd: "DND",
  pressed: "Pressed",
  resting: "Resting",
  off: "Off",
};

const STATUS_COLORS: Record<string, string> = {
  alert: "bg-red-500",
  standby: "bg-amber-400",
  online: "bg-green-500",
  busy: "bg-orange-500",
  dnd: "bg-purple-500",
  pressed: "bg-blue-400",
  resting: "bg-slate-400",
  off: "bg-white/20",
};

const MODEL_OPTIONS = ["gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.1", "gpt-4.1-nano"];

const WICKED_STATUS_ACTIVE: Record<string, string> = {
  online: "bg-green-500/20 text-green-400 border-green-500/40",
  away: "bg-amber-400/20 text-amber-300 border-amber-400/40",
  busy: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  asleep: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  offline: "bg-white/15 text-white/70 border-white/30",
};

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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ChatPage() {
  const [message, setMessage] = useState("");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState(false);
  const [panel, setPanel] = useState<"none" | "diary" | "settings" | "chess" | "connect4">("none");
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [pairingToken, setPairingToken] = useState<string | null>(null);
  const [hangoutPairingToken, setHangoutPairingToken] = useState<string | null>(null);
  const [hangoutActionError, setHangoutActionError] = useState("");
  const [voiceIdDraft, setVoiceIdDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: state } = useQuery<AshState>({
    queryKey: ["/api/state"],
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    setVoiceIdDraft(state?.voiceId ?? "");
  }, [state?.voiceId]);
  const { data: messages = [], isLoading: messagesLoading } = useQuery<AshMessage[]>({
    queryKey: ["/api/messages"],
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });
  const { data: hangout } = useQuery<HangoutStatus>({
    queryKey: ["/api/hangout/status"],
    refetchInterval: 5_000,
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
  const { data: diaryEntries = [] } = useQuery<AshDiaryEntry[]>({
    queryKey: ["/api/diary"],
    enabled: panel === "diary",
    refetchInterval: panel === "diary" ? 30_000 : false,
  });
  const lovenseStatusQuery = useQuery<LovenseStatus>({
    queryKey: ["/api/lovense/status"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/lovense/status");
      return (await response.json()) as LovenseStatus;
    },
    enabled: panel === "settings",
    refetchInterval: panel === "settings" ? 5_000 : false,
  });
  const [lovenseStopWarning, setLovenseStopWarning] = useState<string | null>(null);

  const sendMutation = useMutation({
    mutationFn: async (payload: { content: string; imageDataUrl?: string; requestImage: boolean }) => {
      const response = await apiRequest("POST", "/api/messages", payload);
      return (await response.json()) as SendMessageResponse;
    },
    onSuccess: ({ wickedMessage, ashMessage }) => {
      setHangoutActionError("");
      queryClient.setQueryData<AshMessage[]>(["/api/messages"], (current) =>
        mergeLatestMessages(current, [wickedMessage, ashMessage]),
      );
      void queryClient.invalidateQueries({ queryKey: ["/api/state"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/diary"] });
    },
    onError: (error, payload) => {
      setHangoutActionError(error instanceof Error ? error.message : "Message could not be sent");
      setMessage((current) => current || payload.content);
    },
  });

  const hangoutStartMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/hangout/start");
      return (await response.json()) as HangoutStatus;
    },
    onSuccess: () => {
      setHangoutActionError("");
      void queryClient.invalidateQueries({ queryKey: ["/api/hangout/status"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
    },
    onError: (error) => setHangoutActionError(error instanceof Error ? error.message : "Hangout could not start"),
  });
  const hangoutStopMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/hangout/stop");
    },
    onSuccess: () => {
      setHangoutActionError("");
      void queryClient.invalidateQueries({ queryKey: ["/api/hangout/status"] });
    },
    onError: (error) => setHangoutActionError(error instanceof Error ? error.message : "Hangout could not stop"),
  });
  const hangoutPairMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/hangout/companion/pair");
      return (await response.json()) as { token: string };
    },
    onSuccess: ({ token }) => {
      setHangoutPairingToken(token);
      setHangoutActionError("");
      void queryClient.invalidateQueries({ queryKey: ["/api/hangout/status"] });
    },
    onError: (error) => setHangoutActionError(error instanceof Error ? error.message : "Chat pairing failed"),
  });
  const hangoutRevokeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/hangout/companion/revoke");
    },
    onSuccess: () => {
      setHangoutPairingToken(null);
      setHangoutActionError("");
      void queryClient.invalidateQueries({ queryKey: ["/api/hangout/status"] });
    },
    onError: (error) => setHangoutActionError(error instanceof Error ? error.message : "Chat access could not be revoked"),
  });

  const settingsMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      await apiRequest("PATCH", "/api/state", patch);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/state"] }),
  });

  const lovenseMutation = useMutation({
    mutationFn: async (action: "pair" | "disconnect") => {
      const response = await apiRequest("POST", `/api/lovense/${action}`);
      return (await response.json()) as LovenseStatus;
    },
    onSuccess: (status) => {
      setLovenseStopWarning(status.stopWarning ?? null);
      queryClient.setQueryData(["/api/lovense/status"], status);
    },
  });

  const pairScreenCaptureMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/screen-capture/pair");
      return (await response.json()) as { token: string; companionId: string };
    },
    onSuccess: ({ token }) => {
      setPairingToken(token);
      queryClient.invalidateQueries({ queryKey: ["/api/state"] });
    },
  });

  const revokeScreenCaptureMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/screen-capture/revoke");
    },
    onSuccess: () => {
      setPairingToken(null);
      queryClient.invalidateQueries({ queryKey: ["/api/state"] });
    },
  });

  const deleteDiaryMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/diary/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/diary"] }),
  });

  const purgeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/messages/purge");
    },
    onSuccess: () => {
      setShowPurgeConfirm(false);
      setOlderMessages([]);
      setHasMoreHistory(true);
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/logout");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      window.location.href = "/login";
    },
  });

  const latestMessageId = allMessages[allMessages.length - 1]?.id ?? 0;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [latestMessageId, sendMutation.isPending]);

  const handleSend = () => {
    const content = message.trim();
    if (!content && !pendingImage) return;
    if (sendMutation.isPending) return;
    if (hangout?.status === "active" && pendingImage) {
      setHangoutActionError("During a hangout, send text only; the companion adds a fresh screenshot.");
      return;
    }
    sendMutation.mutate({
      content,
      imageDataUrl: pendingImage || undefined,
      requestImage: imageMode,
    });
    setMessage("");
    setPendingImage(null);
    setImageMode(false);
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
    const image = getClipboardImage(event.clipboardData);
    if (!image) return;
    event.preventDefault();
    if (typeof image === "string") {
      setPendingImage(image);
      return;
    }
    void handleImagePick(image);
  };

  const status = state?.status?.toLowerCase() || "off";
  const killSwitchOn = state?.apiKillSwitch === 1;
  const hangoutReady = !!state?.screenCaptureCompanionId && state?.screenCaptureEnabled === 1
    && !!hangout?.companionPaired && !!hangout?.connected && !killSwitchOn;

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-black via-[#0d0a06] to-black">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gold/20 bg-black/60">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
            data-testid="link-home"
            title="Home"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Flame className="w-7 h-7 text-ember" />
          <div>
            <h1 className="font-serif text-2xl text-gold leading-tight" data-testid="text-title">Ash Cindralis</h1>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[status] || "bg-white/20"}`} data-testid="status-dot" />
              <span className="text-xs text-white/50" data-testid="text-status">
                {STATUS_LABELS[status] || status}
                {killSwitchOn && <span className="text-red-400 ml-2">• BRIDGE OFF</span>}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <a
            href="/api/export-doc"
            download
            className="flex items-center gap-2 px-3.5 py-1.5 mr-1 rounded-lg border border-gold/30 text-gold/90 hover:text-gold hover:bg-gold/10 transition-colors text-sm"
            data-testid="button-export-doc"
            title="Download the full archive (messages + diary) as a Word doc"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export Doc</span>
          </a>
          <button
            onClick={() => setShowPurgeConfirm(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 mr-1 rounded-lg border border-red-500/30 text-red-400/90 hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm"
            data-testid="button-purge"
            title="Wipe the chat clean, keeping only the last 20 messages"
          >
            <Trash2 className="w-4 h-4" />
            <span className="hidden sm:inline">Purge</span>
          </button>
          <Link
            href="/herald"
            className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
            data-testid="link-herald"
            title="The Court Herald (TikTok comments)"
          >
            <Megaphone className="w-5 h-5" />
          </Link>
          <Link
            href="/discord"
            className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
            data-testid="link-discord"
            title="Discord Court Herald"
          >
            <SiDiscord className="w-5 h-5" />
          </Link>
          <Link
            href="/persona"
            className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
            data-testid="link-persona"
            title="Edit Ash's persona packet"
          >
            <ScrollText className="w-5 h-5" />
          </Link>
          <Link
            href="/story"
            className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
            data-testid="link-story"
            title="The Scriptorium (Story Workspace)"
          >
            <Feather className="w-5 h-5" />
          </Link>
          <Link
            href="/cell"
            className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
            data-testid="link-cell"
            title="Cell (mobile chat)"
          >
            <Smartphone className="w-5 h-5" />
          </Link>
          <button
            onClick={() => setPanel(panel === "chess" ? "none" : "chess")}
            className={`p-2 rounded-lg transition-colors ${panel === "chess" ? "text-gold bg-gold/10" : "text-white/50 hover:text-gold hover:bg-white/5"}`}
            data-testid="button-chess"
            title="Chess with Ash"
          >
            <Swords className="w-5 h-5" />
          </button>
          <button
            onClick={() => setPanel(panel === "connect4" ? "none" : "connect4")}
            className={`p-2 rounded-lg transition-colors ${panel === "connect4" ? "text-gold bg-gold/10" : "text-white/50 hover:text-gold hover:bg-white/5"}`}
            data-testid="button-connect4"
            title="Connect Four with Ash"
          >
            <CircleDot className="w-5 h-5" />
          </button>
          <button
            onClick={() => setPanel(panel === "diary" ? "none" : "diary")}
            className={`p-2 rounded-lg transition-colors ${panel === "diary" ? "text-gold bg-gold/10" : "text-white/50 hover:text-gold hover:bg-white/5"}`}
            data-testid="button-diary"
            title="Ash's diary"
          >
            <BookOpen className="w-5 h-5" />
          </button>
          <button
            onClick={() => setPanel(panel === "settings" ? "none" : "settings")}
            className={`p-2 rounded-lg transition-colors ${panel === "settings" ? "text-gold bg-gold/10" : "text-white/50 hover:text-gold hover:bg-white/5"}`}
            data-testid="button-settings"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
          <button
            onClick={() => logoutMutation.mutate()}
            className="p-2 rounded-lg text-white/50 hover:text-red-400 hover:bg-white/5 transition-colors"
            data-testid="button-logout"
            title="Log out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="px-4 py-2 border-b border-gold/15 bg-black/50 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="panel-hangout">
        <Monitor className="w-4 h-4 text-gold/70" />
        <span className="text-white/75" data-testid="status-hangout">
          Hangout: {hangout?.status === "active" ? "Active in Windows pop-out" : hangout?.status === "inviting" ? "Waiting for Ash's answer" : "Off"}
          {hangout && !hangout.connected ? " · companion offline" : ""}
        </span>
        {hangout?.status === "idle" ? (
          <button
            onClick={() => hangoutStartMutation.mutate()}
            disabled={!hangoutReady || hangoutStartMutation.isPending}
            title={hangoutReady ? "Invite Ash to hang out with screenshots" : "Pair and connect the Windows companion, enable screenshots, and turn the bridge on"}
            className="text-gold border border-gold/30 rounded-md px-2.5 py-1 hover:bg-gold/10 disabled:opacity-40"
            data-testid="button-start-hangout"
          >
            {hangoutStartMutation.isPending ? "Inviting…" : "Start Hangout"}
          </button>
        ) : hangout && (
          <button
            onClick={() => hangoutStopMutation.mutate()}
            disabled={hangoutStopMutation.isPending}
            className="text-white/65 hover:text-red-300 underline underline-offset-2 disabled:opacity-40"
            data-testid="button-stop-hangout"
          >
            Stop
          </button>
        )}
        {hangout?.lastError && <span className="text-red-300" data-testid="status-hangout-error">{hangout.lastError}</span>}
        {hangoutActionError && <span className="text-red-300" data-testid="status-hangout-action-error">{hangoutActionError}</span>}
      </div>

      {/* My Status (Wicked) */}
      <div className="px-4 py-2 border-b border-white/10 bg-black/40 flex flex-wrap items-center gap-2" data-testid="panel-my-status">
        <span className="text-xs uppercase tracking-wider text-gold/80 font-semibold mr-1">My Status</span>
        {(["online", "away", "busy", "asleep", "offline"] as const).map((s) => (
          <button
            key={s}
            onClick={() => settingsMutation.mutate({ wickedStatus: s })}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold capitalize border transition-colors ${
              (state?.wickedStatus || "online") === s
                ? WICKED_STATUS_ACTIVE[s]
                : "bg-white/5 text-white/50 border-white/10 hover:text-white/80"
            }`}
            data-testid={`button-wicked-status-${s}`}
          >
            {s}
          </button>
        ))}
        <input
          type="text"
          placeholder="Live status... e.g. I'll be in the Great Hall for the next hour"
          defaultValue={state?.wickedStatusMessage || ""}
          key={state?.wickedStatusMessage || ""}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (state?.wickedStatusMessage || "")) {
              settingsMutation.mutate({ wickedStatusMessage: v });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="flex-1 min-w-[220px] bg-black/60 border border-white/15 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-gold/40 font-serif italic"
          data-testid="input-wicked-status-message"
        />
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Chat column */}
        <div className="flex-1 flex flex-col min-w-0">
          <div
            className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
            style={{
              backgroundImage: `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.55)), url(${throneDamask})`,
              backgroundSize: "auto, 900px auto",
              backgroundRepeat: "repeat",
            }}
          >
            {messagesLoading && (
              <div className="text-white/30 text-sm text-center py-8">Loading...</div>
            )}
            {!messagesLoading && messages.length === 0 && (
              <div className="text-white/30 text-sm text-center py-8 font-serif italic">
                The hearth is quiet. Say something.
              </div>
            )}
            {!messagesLoading && messages.length >= 300 && hasMoreHistory && (
              <div className="text-center py-1">
                <button
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className="px-4 py-1.5 rounded-full text-xs text-gold/70 hover:text-gold bg-white/5 border border-white/10 hover:border-gold/30 transition-colors disabled:opacity-50"
                  data-testid="button-load-older"
                >
                  {loadingOlder ? "Fetching the archives..." : "↑ Load earlier messages"}
                </button>
              </div>
            )}
            {allMessages.map((m, i) => (
              <div key={m.id}>
                {(i === 0 || dayStamp(allMessages[i - 1]!) !== dayStamp(m)) && dayStamp(m) && (
                  <div className="flex items-center gap-3 py-2" data-testid={`day-divider-${m.id}`}>
                    <div className="flex-1 h-px bg-gold/15" />
                    <span className="text-xs text-gold/60 font-serif tracking-wide">{dayStamp(m)}</span>
                    <div className="flex-1 h-px bg-gold/15" />
                  </div>
                )}
              <div
                className={`flex ${m.role === "wicked" ? "justify-end" : "justify-start"}`}
                data-testid={`message-${m.id}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                    m.role === "wicked"
                      ? "bg-gold/15 border border-gold/25 text-white"
                      : m.source === "self_prompt"
                      ? "bg-ember/10 border border-ember/30 text-white/90"
                      : "bg-white/5 border border-white/10 text-white/90"
                  }`}
                >
                  <div className="text-[10px] text-white/30 mb-1" data-testid={`stamp-message-${m.id}`}>
                    {messageStamp(m)}
                  </div>
                  {m.source === "self_prompt" && (
                    <div className="text-[10px] uppercase tracking-wider text-ember/80 mb-1">Reflection</div>
                  )}
                  {m.imageUrl && (
                    <img
                      src={m.imageUrl}
                      alt="shared"
                      className="rounded-lg mb-2 max-h-80"
                      data-testid={`img-message-${m.id}`}
                    />
                  )}
                  {m.content && <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{m.content}</p>}
                </div>
              </div>
              </div>
            ))}
            {sendMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3 flex items-center gap-2 text-white/50">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm font-serif italic">Ash is thinking...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div className="border-t border-gold/20 bg-black/60 px-4 py-3">
            {pendingImage && (
              <div className="relative inline-block mb-2">
                <img src={pendingImage} alt="attached" className="max-h-28 rounded-lg border border-white/20" data-testid="img-pending" />
                <button
                  onClick={() => setPendingImage(null)}
                  className="absolute -top-2 -right-2 bg-black/80 border border-white/30 rounded-full p-0.5 text-white/80 hover:text-white"
                  data-testid="button-remove-image"
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
                data-testid="input-file"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-2.5 rounded-xl bg-white/5 text-white/50 hover:text-gold hover:bg-white/10 transition-colors"
                data-testid="button-attach"
                title="Attach image or paste one into the message box"
              >
                <ImagePlus className="w-5 h-5" />
              </button>
              <button
                onClick={() => setImageMode((v) => !v)}
                className={`p-2.5 rounded-xl transition-colors ${
                  imageMode
                    ? "bg-amber-500/30 text-amber-300 hover:bg-amber-500/40"
                    : "bg-white/5 text-white/50 hover:text-gold hover:bg-white/10"
                }`}
                data-testid="button-picture-mode"
                title={imageMode ? "Picture mode ON — the reply will include a picture" : "Picture mode OFF"}
              >
                <Wand2 className="w-5 h-5" />
              </button>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onPaste={handleImagePaste}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Message Ash… or paste a picture"
                rows={1}
                className="flex-1 bg-white/5 text-white placeholder-white/30 rounded-xl px-4 py-2.5 resize-none outline-none border border-white/10 focus:border-gold/40"
                style={{ maxHeight: 140 }}
                data-testid="input-message"
              />
              <button
                onClick={handleSend}
                disabled={(!message.trim() && !pendingImage) || sendMutation.isPending}
                className="p-2.5 rounded-xl bg-gold/15 text-gold hover:bg-gold/25 transition-colors disabled:opacity-30"
                data-testid="button-send"
              >
                {sendMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Chess — full window */}
        {panel === "chess" && <ChessPanel onClose={() => setPanel("none")} />}

        {/* Connect Four — full window */}
        {panel === "connect4" && <Connect4Panel onClose={() => setPanel("none")} />}

        {/* Purge confirmation */}
        {showPurgeConfirm && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
            <div className="bg-[#141210] border border-red-500/30 rounded-2xl p-6 max-w-md w-full space-y-4">
              <h3 className="font-serif text-xl text-red-400 flex items-center gap-2">
                <Trash2 className="w-5 h-5" /> Purge the chat?
              </h3>
              <p className="text-white/70 text-sm leading-relaxed">
                This wipes the chat clean, keeping only the <span className="text-gold">last 20 messages</span>.
                Everything older is gone for good — Ash's diary is untouched.
              </p>
              <p className="text-white/40 text-xs">
                Tip: hit Export Doc first if you want the full archive saved.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowPurgeConfirm(false)}
                  className="px-4 py-2 rounded-lg bg-white/5 text-white/60 border border-white/10 hover:text-white transition-colors text-sm"
                  data-testid="button-purge-cancel"
                >
                  Keep everything
                </button>
                <button
                  onClick={() => purgeMutation.mutate()}
                  disabled={purgeMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors text-sm font-semibold disabled:opacity-50"
                  data-testid="button-purge-confirm"
                >
                  {purgeMutation.isPending ? "Purging..." : "Purge it"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Diary — full window */}
        {panel === "diary" && (
          <div className="fixed inset-0 z-50 bg-gradient-to-b from-black via-[#0d0a06] to-black overflow-y-auto" data-testid="panel-diary">
            <div className="max-w-3xl mx-auto px-6 py-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-serif text-3xl text-gold flex items-center gap-3">
                  <BookOpen className="w-7 h-7" /> Ash's Diary
                </h2>
                <button
                  onClick={() => setPanel("none")}
                  className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
                  data-testid="button-close-diary"
                  title="Close diary"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              {diaryEntries.length === 0 && (
                <p className="text-white/30 text-base italic font-serif">No entries yet.</p>
              )}
              <div className="space-y-4">
                {diaryEntries.map((entry) => (
                  <div key={entry.id} className="bg-white/5 border border-white/10 rounded-xl p-5" data-testid={`diary-entry-${entry.id}`}>
                    <p className="text-white/85 text-[15px] whitespace-pre-wrap leading-relaxed">{entry.content}</p>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs text-white/30">
                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : ""}
                      </span>
                      <button
                        onClick={() => deleteDiaryMutation.mutate(entry.id)}
                        className="text-white/25 hover:text-red-400 transition-colors"
                        data-testid={`button-delete-diary-${entry.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {panel === "settings" && state && (
          <aside className="w-96 order-first border-r border-gold/20 bg-black/40 overflow-y-auto p-4 space-y-5" data-testid="panel-settings">
            <h2 className="font-serif text-xl text-gold flex items-center gap-2">
              <Settings className="w-5 h-5" /> Settings
            </h2>

            {/* Bridge kill switch */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <Power className={`w-4 h-4 ${killSwitchOn ? "text-red-400" : "text-green-400"}`} />
                    Bridge Shut-Off
                  </h3>
                  <p className="text-white/40 text-xs mt-1">
                    {killSwitchOn ? "All Ash API calls are STOPPED." : "Bridge is live — Ash can speak."}
                  </p>
                </div>
                <button
                  onClick={() => settingsMutation.mutate({ apiKillSwitch: killSwitchOn ? 0 : 1 })}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    killSwitchOn
                      ? "bg-red-500/20 text-red-400 border border-red-500/40"
                      : "bg-green-500/15 text-green-400 border border-green-500/30"
                  }`}
                  data-testid="button-kill-switch"
                >
                  {killSwitchOn ? "OFF" : "ON"}
                </button>
              </div>
            </div>

            {/* Lovense pairing */}
            <div className="min-w-0 bg-white/5 border border-white/10 rounded-xl p-4 space-y-3" data-testid="card-lovense-pairing">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <QrCode className="w-4 h-4 shrink-0 text-gold" /> Lovense pairing
                  </h3>
                  {lovenseStatusQuery.data ? (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs" data-testid="status-lovense">
                      <span className={lovenseStatusQuery.data.configured ? "text-green-400" : "text-amber-300"}>
                        {lovenseStatusQuery.data.configured ? "Configured" : "Not configured"}
                      </span>
                      <span className={lovenseStatusQuery.data.connected ? "text-green-400" : "text-white/50"}>
                        {lovenseStatusQuery.data.connected ? "Paired" : "Not paired"}
                      </span>
                    </div>
                  ) : lovenseStatusQuery.isLoading ? (
                    <p className="text-white/40 text-xs mt-1">Checking connection…</p>
                  ) : null}
                </div>
                {lovenseStatusQuery.data?.connected && (
                  <span className="w-2 h-2 mt-2 rounded-full bg-green-400 shrink-0" aria-label="Connected" />
                )}
              </div>

              {!lovenseStatusQuery.data?.configured && lovenseStatusQuery.data && (
                <p className="text-white/50 text-xs">
                  {lovenseStatusQuery.data.previewOnly
                    ? "Pairing and device controls are disabled in preview. Open the published Stillwater app to pair."
                    : "Lovense pairing is unavailable until the server is configured."}
                </p>
              )}

              {lovenseStatusQuery.data && !lovenseStatusQuery.data.connected && lovenseStatusQuery.data.qrUrl && (
                <div className="flex flex-col items-center gap-2 rounded-lg bg-white p-3">
                  <img
                    src={lovenseStatusQuery.data.qrUrl}
                    alt="Lovense pairing QR code"
                    className="w-40 max-w-full aspect-square object-contain"
                    data-testid="img-lovense-qr"
                  />
                  {lovenseStatusQuery.data.expiresAt && (
                    <p className="text-center text-xs text-black/60" data-testid="text-lovense-expiry">
                      Expires {new Date(lovenseStatusQuery.data.expiresAt).toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <p className="text-xs text-white/50">Callback URL for the Lovense developer dashboard (open published Stillwater)</p>
                <p className="text-xs text-amber-300/80">If this Lovense developer app also serves Summer Palace, changing its single callback URL may stop Summer Palace from receiving new pairings. Use a separate developer app if both need to pair independently.</p>
                {lovenseStatusQuery.data?.callbackUrl ? (
                  <code className="block max-w-full break-all rounded-md bg-black/40 px-2 py-1.5 text-xs text-gold/90" data-testid="text-lovense-callback-url">
                    {lovenseStatusQuery.data.callbackUrl}
                  </code>
                ) : (
                  <p className="text-xs text-white/40">{lovenseStatusQuery.data?.previewOnly ? "Available only on the published app" : "Loading callback URL…"}</p>
                )}
              </div>

              {lovenseStatusQuery.isError && (
                <p className="text-red-300 text-xs break-words" role="alert" data-testid="error-lovense-status">
                  {lovenseStatusQuery.error instanceof Error ? lovenseStatusQuery.error.message : "Lovense status could not be loaded."}
                </p>
              )}
              {lovenseMutation.isError && (
                <p className="text-red-300 text-xs break-words" role="alert" data-testid="error-lovense-action">
                  {lovenseMutation.error instanceof Error ? lovenseMutation.error.message : "Lovense pairing action failed."}
                </p>
              )}
              {lovenseStopWarning && (
                <p className="text-amber-300 text-xs break-words" role="alert">{lovenseStopWarning}</p>
              )}

              <div className="flex flex-wrap gap-2">
                {lovenseStatusQuery.data?.connected ? (
                  <button
                    onClick={() => lovenseMutation.mutate("disconnect")}
                    disabled={lovenseMutation.isPending}
                    className="flex-1 min-w-[8rem] py-2 rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 text-sm font-semibold hover:bg-red-500/25 disabled:opacity-50"
                    data-testid="button-lovense-disconnect"
                  >
                    {lovenseMutation.isPending ? "Working…" : "Disconnect"}
                  </button>
                ) : (
                  <button
                    onClick={() => lovenseMutation.mutate("pair")}
                    disabled={!lovenseStatusQuery.data?.configured || lovenseMutation.isPending}
                    className="flex-1 min-w-[8rem] py-2 rounded-lg bg-gold/15 text-gold border border-gold/30 text-sm font-semibold hover:bg-gold/25 disabled:opacity-40 flex items-center justify-center gap-2"
                    data-testid="button-lovense-pair"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${lovenseMutation.isPending ? "animate-spin" : ""}`} />
                    {lovenseMutation.isPending ? "Pairing…" : lovenseStatusQuery.data?.qrUrl ? "Refresh pairing" : "Pair"}
                  </button>
                )}
              </div>
            </div>

            {/* Model toggle */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
              <h3 className="text-white font-semibold">Model</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => settingsMutation.mutate({ activeModel: "primary" })}
                  className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
                    state.activeModel === "primary"
                      ? "bg-gold/20 text-gold border border-gold/40"
                      : "bg-white/5 text-white/50 border border-white/10"
                  }`}
                  data-testid="button-model-primary"
                >
                  Primary
                </button>
                <button
                  onClick={() => settingsMutation.mutate({ activeModel: "fallback" })}
                  className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
                    state.activeModel === "fallback"
                      ? "bg-gold/20 text-gold border border-gold/40"
                      : "bg-white/5 text-white/50 border border-white/10"
                  }`}
                  data-testid="button-model-fallback"
                >
                  Fallback
                </button>
              </div>
              <div className="space-y-2">
                <label className="block">
                  <span className="text-xs text-white/40">Primary model</span>
                  <select
                    value={state.modelPrimary}
                    onChange={(e) => settingsMutation.mutate({ modelPrimary: e.target.value })}
                    className="w-full mt-1 bg-black/60 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-gold/40"
                    data-testid="select-model-primary"
                  >
                    {MODEL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-white/40">Fallback model</span>
                  <select
                    value={state.modelFallback}
                    onChange={(e) => settingsMutation.mutate({ modelFallback: e.target.value })}
                    className="w-full mt-1 bg-black/60 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-gold/40"
                    data-testid="select-model-fallback"
                  >
                    {MODEL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              </div>
            </div>

            {/* Voice */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
              <div>
                <h3 className="text-white font-semibold">Ash’s Voice</h3>
                <p className="text-white/40 text-xs mt-1">ElevenLabs voice used by TTS in the Cell.</p>
              </div>
              <label className="block">
                <span className="text-xs text-white/40">Voice ID</span>
                <input
                  value={voiceIdDraft}
                  onChange={(event) => setVoiceIdDraft(event.target.value)}
                  className="w-full mt-1 bg-black/60 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-gold/40"
                  placeholder="ElevenLabs voice ID"
                  data-testid="input-voice-id"
                />
              </label>
              <button
                onClick={() => settingsMutation.mutate({ voiceId: voiceIdDraft.trim() })}
                disabled={settingsMutation.isPending || voiceIdDraft.trim() === state.voiceId}
                className="w-full py-2 rounded-lg bg-gold/15 text-gold border border-gold/30 text-sm font-semibold hover:bg-gold/25 disabled:opacity-40"
                data-testid="button-save-voice-id"
              >
                {settingsMutation.isPending ? "Saving…" : "Save Voice ID"}
              </button>
            </div>

            {/* Status + pings */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
              <h3 className="text-white font-semibold">Status & Pings</h3>
              <label className="block">
                <span className="text-xs text-white/40">Status (manual override)</span>
                <select
                  value={status}
                  onChange={(e) => settingsMutation.mutate({ status: e.target.value })}
                  className="w-full mt-1 bg-black/60 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-gold/40"
                  data-testid="select-status"
                >
                  {Object.entries(STATUS_LABELS).filter(([k]) => k !== "off").map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
                </select>
              </label>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-white/80">Proactive pings</span>
                  <p className="text-white/40 text-xs">Reflective self-prompt windows</p>
                </div>
                <button
                  onClick={() => settingsMutation.mutate({ selfPromptPaused: state.selfPromptPaused === 1 ? 0 : 1 })}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    state.selfPromptPaused === 1
                      ? "bg-white/10 text-white/40 border border-white/15"
                      : "bg-gold/15 text-gold border border-gold/30"
                  }`}
                  data-testid="button-pings-toggle"
                >
                  {state.selfPromptPaused === 1 ? "Paused" : "Active"}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm text-white/80">History in proactive windows</span>
                  <p className="text-white/40 text-xs">Include the last 20 messages in self-prompt packets</p>
                </div>
                <button
                  onClick={() => settingsMutation.mutate({ selfPromptIncludeHistory: state.selfPromptIncludeHistory === 1 ? 0 : 1 })}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                    state.selfPromptIncludeHistory === 1
                      ? "bg-gold/15 text-gold border border-gold/30"
                      : "bg-white/10 text-white/40 border border-white/15"
                  }`}
                  data-testid="button-history-toggle"
                >
                  {state.selfPromptIncludeHistory === 1 ? "Included" : "Excluded"}
                </button>
              </div>
              <label className="block">
                <span className="text-xs text-white/40">Ping interval override (hours, 0 = status-based)</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  key={state.selfPromptIntervalOverride}
                  defaultValue={state.selfPromptIntervalOverride ? +(state.selfPromptIntervalOverride / 60).toFixed(2) : 0}
                  onBlur={(e) => {
                    const hours = parseFloat(e.target.value);
                    if (isNaN(hours) || hours < 0) return;
                    const minutes = Math.round(hours * 60);
                    if (minutes !== state.selfPromptIntervalOverride) {
                      settingsMutation.mutate({ selfPromptIntervalOverride: minutes });
                    }
                  }}
                  className="w-full mt-1 bg-black/60 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-gold/40"
                  data-testid="input-ping-override"
                />
              </label>
              <div className="border-t border-white/10 pt-3 mt-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <Monitor className="w-4 h-4 text-gold/70 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-sm text-white/80">Desktop screenshots</span>
                      <p className="text-white/40 text-xs">Fresh full-desktop capture on each scheduled proactive ping</p>
                    </div>
                  </div>
                  <button
                    onClick={() => settingsMutation.mutate({ screenCaptureEnabled: state.screenCaptureEnabled === 1 ? 0 : 1 })}
                    disabled={!state.screenCaptureCompanionId || settingsMutation.isPending}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                      state.screenCaptureEnabled === 1
                        ? "bg-gold/15 text-gold border border-gold/30"
                        : "bg-white/10 text-white/40 border border-white/15"
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                    data-testid="button-screenshots-toggle"
                    title={state.screenCaptureCompanionId ? "Turn automatic screenshots on or off" : "Pair the Windows companion first"}
                  >
                    {state.screenCaptureEnabled === 1 ? "ON" : "OFF"}
                  </button>
                </div>
                <p className="text-white/35 text-xs mt-2">
                  ON runs automatically after pairing—there is no approval prompt for each screenshot. OFF stops new captures.
                </p>
                <p className="text-white/45 text-xs mt-2">
                  Easy setup: download the app, pair it here, paste the one-time token into the app, then click Start.
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <a
                    href="/api/screen-capture/companion"
                    download
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white/70 border border-white/20 hover:bg-white/5"
                    data-testid="link-download-companion"
                  >
                    Download Windows app
                  </a>
                  <button
                    onClick={() => pairScreenCaptureMutation.mutate()}
                    disabled={pairScreenCaptureMutation.isPending}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gold border border-gold/30 hover:bg-gold/10 disabled:opacity-50"
                    data-testid="button-pair-screenshots"
                  >
                    {pairScreenCaptureMutation.isPending ? "Creating..." : state.screenCaptureCompanionId ? "Pair new companion" : "Pair Windows companion"}
                  </button>
                  {state.screenCaptureCompanionId && (
                    <button
                      onClick={() => revokeScreenCaptureMutation.mutate()}
                      disabled={revokeScreenCaptureMutation.isPending}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 border border-red-500/30 hover:bg-red-500/10 disabled:opacity-50"
                      data-testid="button-revoke-screenshots"
                    >
                      Revoke pairing
                    </button>
                  )}
                </div>
                {pairingToken && (
                  <div className="mt-3 rounded-lg bg-black/60 border border-gold/20 p-3">
                    <p className="text-xs text-gold/80 mb-1">Copy this one-time pairing token into the Windows app:</p>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={pairingToken}
                        className="min-w-0 flex-1 bg-black border border-white/15 rounded px-2 py-1.5 text-[11px] text-white/80 font-mono"
                        data-testid="input-pairing-token"
                      />
                      <button
                        onClick={() => void navigator.clipboard?.writeText(pairingToken)}
                        className="p-2 rounded text-gold hover:bg-gold/10"
                        title="Copy pairing token"
                        data-testid="button-copy-pairing-token"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-white/35 text-[11px] mt-2">This token is shown only once. Pairing again replaces the previous token.</p>
                  </div>
                )}
                <div className="text-[11px] text-white/35 mt-2 space-y-0.5">
                  <p>Companion: {state.screenCaptureCompanionId ? "paired" : "not paired"}{state.screenCaptureLastSeen ? ` • last seen ${new Date(state.screenCaptureLastSeen).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}</p>
                  {state.screenCaptureLastCaptureAt && <p>Last capture: {new Date(state.screenCaptureLastCaptureAt).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</p>}
                  {state.screenCaptureLastError && <p className="text-red-300/70">{state.screenCaptureLastError}</p>}
                </div>
                <div className="border-t border-white/10 pt-3 mt-4 space-y-2">
                  <p className="text-sm text-white/80">Hangout pop-out chat access</p>
                  <p className="text-xs text-white/40">
                    The Windows app needs a separate, chat-only token to display and send messages.
                    Paste it into its Hangout chat token field. Screenshots still use the capture token and ON/OFF switch above.
                  </p>
                  <p className="text-xs text-white/55" data-testid="status-hangout-pairing">
                    Chat: {hangout?.companionPaired ? hangout.connected ? "connected" : "paired, waiting for companion" : "not paired"}
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => hangoutPairMutation.mutate()}
                      disabled={!state.screenCaptureCompanionId || hangoutPairMutation.isPending}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gold border border-gold/30 hover:bg-gold/10 disabled:opacity-40"
                      data-testid="button-pair-hangout"
                    >
                      {hangoutPairMutation.isPending ? "Creating..." : hangout?.companionPaired ? "Replace chat token" : "Create chat token"}
                    </button>
                    {hangout?.companionPaired && (
                      <button
                        onClick={() => hangoutRevokeMutation.mutate()}
                        disabled={hangoutRevokeMutation.isPending}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 border border-red-500/30 hover:bg-red-500/10 disabled:opacity-40"
                        data-testid="button-revoke-hangout"
                      >
                        Revoke chat access
                      </button>
                    )}
                  </div>
                  {hangoutPairingToken && (
                    <div className="rounded-lg bg-black/60 border border-gold/20 p-3">
                      <p className="text-xs text-gold/80 mb-2">Shown once — copy to the Windows app:</p>
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          value={hangoutPairingToken}
                          className="min-w-0 flex-1 bg-black border border-white/15 rounded px-2 py-1.5 text-[11px] text-white/80 font-mono"
                          data-testid="input-hangout-token"
                        />
                        <button
                          onClick={() => void navigator.clipboard?.writeText(hangoutPairingToken)}
                          className="p-2 rounded text-gold hover:bg-gold/10"
                          title="Copy chat token"
                          data-testid="button-copy-hangout-token"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <h3 className="text-white font-semibold mb-2">Stats</h3>
              <div className="text-sm text-white/50 space-y-1">
                <p data-testid="text-tokens">Tokens used this month: {state.tokensUsed.toLocaleString()}</p>
                <p data-testid="text-heartbeat">
                  Last heartbeat: {state.lastHeartbeat ? new Date(state.lastHeartbeat).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }) : "never"}
                </p>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
