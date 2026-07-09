import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AshMessage, AshState, AshDiaryEntry } from "@/lib/types";
import {
  Flame, Send, Loader2, ImagePlus, Wand2, X, BookOpen, Settings,
  Smartphone, LogOut, Power, Trash2,
} from "lucide-react";

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

const MODEL_OPTIONS = ["gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4o", "gpt-4o-mini"];

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
  const [panel, setPanel] = useState<"none" | "diary" | "settings">("none");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: state } = useQuery<AshState>({
    queryKey: ["/api/state"],
    refetchInterval: 15_000,
  });
  const { data: messages = [], isLoading: messagesLoading } = useQuery<AshMessage[]>({
    queryKey: ["/api/messages"],
    refetchInterval: 10_000,
  });
  const { data: diaryEntries = [] } = useQuery<AshDiaryEntry[]>({
    queryKey: ["/api/diary"],
    enabled: panel === "diary",
    refetchInterval: panel === "diary" ? 30_000 : false,
  });

  const sendMutation = useMutation({
    mutationFn: async (payload: { content: string; imageDataUrl?: string; requestImage: boolean }) => {
      await apiRequest("POST", "/api/messages", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/state"] });
      queryClient.invalidateQueries({ queryKey: ["/api/diary"] });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      await apiRequest("PATCH", "/api/state", patch);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/state"] }),
  });

  const deleteDiaryMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/diary/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/diary"] }),
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

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

  const status = state?.status?.toLowerCase() || "off";
  const killSwitchOn = state?.apiKillSwitch === 1;

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-black via-[#0d0a06] to-black">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gold/20 bg-black/60">
        <div className="flex items-center gap-3">
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
          <Link
            href="/cell"
            className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
            data-testid="link-cell"
            title="Cell (mobile chat)"
          >
            <Smartphone className="w-5 h-5" />
          </Link>
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

      <div className="flex-1 flex min-h-0">
        {/* Chat column */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messagesLoading && (
              <div className="text-white/30 text-sm text-center py-8">Loading...</div>
            )}
            {!messagesLoading && messages.length === 0 && (
              <div className="text-white/30 text-sm text-center py-8 font-serif italic">
                The hearth is quiet. Say something.
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
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
                  <div className="text-[10px] text-white/25 mt-1">
                    {m.createdAt ? new Date(m.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : ""}
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
                title="Attach image"
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
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Message Ash..."
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

        {/* Side panel */}
        {panel === "diary" && (
          <aside className="w-96 border-l border-gold/20 bg-black/40 overflow-y-auto p-4" data-testid="panel-diary">
            <h2 className="font-serif text-xl text-gold mb-3 flex items-center gap-2">
              <BookOpen className="w-5 h-5" /> Ash's Diary
            </h2>
            {diaryEntries.length === 0 && (
              <p className="text-white/30 text-sm italic">No entries yet.</p>
            )}
            <div className="space-y-3">
              {diaryEntries.map((entry) => (
                <div key={entry.id} className="bg-white/5 border border-white/10 rounded-xl p-3" data-testid={`diary-entry-${entry.id}`}>
                  <p className="text-white/85 text-sm whitespace-pre-wrap leading-relaxed">{entry.content}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] text-white/30">
                      {entry.createdAt ? new Date(entry.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : ""}
                    </span>
                    <button
                      onClick={() => deleteDiaryMutation.mutate(entry.id)}
                      className="text-white/25 hover:text-red-400 transition-colors"
                      data-testid={`button-delete-diary-${entry.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}

        {panel === "settings" && state && (
          <aside className="w-96 border-l border-gold/20 bg-black/40 overflow-y-auto p-4 space-y-5" data-testid="panel-settings">
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
                <span className="text-xs text-white/40">Ping interval override (minutes, 0 = status-based)</span>
                <input
                  type="number"
                  min={0}
                  defaultValue={state.selfPromptIntervalOverride}
                  onBlur={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 0 && v !== state.selfPromptIntervalOverride) {
                      settingsMutation.mutate({ selfPromptIntervalOverride: v });
                    }
                  }}
                  className="w-full mt-1 bg-black/60 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-gold/40"
                  data-testid="input-ping-override"
                />
              </label>
            </div>

            {/* Voice */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
              <h3 className="text-white font-semibold">Voice (ElevenLabs)</h3>
              <label className="block">
                <span className="text-xs text-white/40">Voice ID</span>
                <input
                  type="text"
                  defaultValue={state.voiceId}
                  onBlur={(e) => {
                    if (e.target.value !== state.voiceId) {
                      settingsMutation.mutate({ voiceId: e.target.value.trim() });
                    }
                  }}
                  placeholder="ElevenLabs voice ID"
                  className="w-full mt-1 bg-black/60 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-gold/40"
                  data-testid="input-voice-id"
                />
              </label>
            </div>

            {/* Stats */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <h3 className="text-white font-semibold mb-2">Stats</h3>
              <div className="text-sm text-white/50 space-y-1">
                <p data-testid="text-tokens">Tokens used: {state.tokensUsed.toLocaleString()}</p>
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
