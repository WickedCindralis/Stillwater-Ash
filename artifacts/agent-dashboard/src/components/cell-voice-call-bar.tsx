import { Loader2, Mic, MicOff, PhoneOff, Volume2, VolumeX } from "lucide-react";

interface CellVoiceCallBarProps {
  listening: boolean;
  speaking: boolean;
  processing: boolean;
  volume: number;
  showVolume: boolean;
  onToggleVolume: () => void;
  onVolumeChange: (volume: number) => void;
  onEnd: () => void;
  onToggleMic: () => void;
}

export default function CellVoiceCallBar({
  listening,
  speaking,
  processing,
  volume,
  showVolume,
  onToggleVolume,
  onVolumeChange,
  onEnd,
  onToggleMic,
}: CellVoiceCallBarProps) {
  const status = listening ? "Listening" : speaking ? "Speaking" : processing ? "Processing" : "Muted";
  const hint = listening
    ? "Tap the microphone to send"
    : speaking
      ? "Ash is speaking"
      : processing
        ? "Waiting for Ash"
        : "Tap the microphone to talk";

  return (
    <div className="flex items-center justify-center gap-3 sm:gap-4 py-2 min-h-[64px]" data-testid="cell-voice-call-bar">
      <div className="relative">
        <button
          type="button"
          onClick={onToggleVolume}
          className="min-w-11 min-h-11 flex items-center justify-center rounded-xl bg-white/10 text-white/70 hover:text-white"
          aria-label="Reply volume controls"
          aria-expanded={showVolume}
          data-testid="button-cell-call-volume"
        >
          {volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
        {showVolume && (
          <div className="absolute z-20 bottom-full left-0 mb-2 w-48 rounded-xl border border-white/15 bg-zinc-950 p-3 shadow-xl">
            <label htmlFor="cell-call-volume" className="mb-2 block text-xs text-white/60">Ash’s reply volume</label>
            <input
              id="cell-call-volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(event) => onVolumeChange(Number(event.target.value))}
              className="w-full accent-amber-300"
              data-testid="input-cell-call-volume"
            />
            <div className="mt-1 text-right text-[10px] text-white/40">{Math.round(volume * 100)}%</div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onEnd}
        className="min-w-12 min-h-12 flex items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700"
        title="End voice call"
        aria-label="End voice call"
        data-testid="button-cell-call-end"
      >
        <PhoneOff className="w-5 h-5" />
      </button>

      <button
        type="button"
        onClick={onToggleMic}
        disabled={speaking || processing}
        className={`min-w-12 min-h-12 flex items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
          listening ? "bg-red-600 text-white animate-pulse" : "bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30"
        }`}
        title={listening ? "Tap to stop and send" : "Tap to talk"}
        aria-label={listening ? "Stop listening and send" : "Start listening"}
        aria-pressed={listening}
        data-testid="button-cell-call-mic"
      >
        {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : listening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
      </button>

      <div className="min-w-0 text-left" role="status" aria-live="polite" data-testid="cell-voice-call-status">
        <div className="text-sm font-semibold text-white">{status}</div>
        <div className="max-w-40 truncate text-[11px] text-white/45">{hint}</div>
      </div>
    </div>
  );
}