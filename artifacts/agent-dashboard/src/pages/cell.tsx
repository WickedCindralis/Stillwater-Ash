import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AshMessage, AshState } from "@/lib/types";
import {
  Send, Loader2, ImagePlus, Wand2, X, ArrowLeft,
} from "lucide-react";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function CellPage() {
  const [message, setMessage] = useState("");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: state } = useQuery<AshState>({
    queryKey: ["/api/state"],
    refetchInterval: 20_000,
  });
  const { data: messages = [] } = useQuery<AshMessage[]>({
    queryKey: ["/api/messages"],
    refetchInterval: 8_000,
  });

  const sendMutation = useMutation({
    mutationFn: async (payload: { content: string; imageDataUrl?: string; requestImage: boolean }) => {
      await apiRequest("POST", "/api/messages", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
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
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "wicked" ? "justify-end" : "justify-start"}`} data-testid={`cell-message-${m.id}`}>
            <div
              className={`max-w-[82%] rounded-2xl px-3.5 py-2 ${
                m.role === "wicked"
                  ? "bg-gold/15 border border-gold/25 text-white"
                  : m.source === "self_prompt"
                  ? "bg-ember/10 border border-ember/30 text-white/90"
                  : "bg-white/8 border border-white/10 text-white/90"
              }`}
            >
              {m.source === "self_prompt" && (
                <div className="text-lg uppercase tracking-wider text-ember/80 mb-0.5">Reflection</div>
              )}
              {m.imageUrl && (
                <img src={m.imageUrl} alt="shared" className="rounded-lg mb-1.5 max-h-64" data-testid={`img-cell-${m.id}`} />
              )}
              {m.content && <p className="whitespace-pre-wrap text-lg leading-relaxed">{m.content}</p>}
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
            title="Attach image"
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
            placeholder="Message Ash..."
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
