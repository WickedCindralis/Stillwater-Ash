import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SystemInfo } from "@/lib/types";
import { ArrowLeft, Gauge as GaugeIcon, Server } from "lucide-react";

const GAUGE_MAX = 39;
const GAUGE_TICKS = [0, 7, 13, 20, 26, 33, 39];

function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function Gauge({ value, label, active }: { value: number; label: string; active: boolean }) {
  const clamped = Math.max(0, Math.min(value, GAUGE_MAX));
  const angle = -120 + (clamped / GAUGE_MAX) * 240;
  const [nx, ny] = polar(60, 60, 38, angle);

  return (
    <div className="flex flex-col items-center" data-testid="gauge-ash">
      <svg viewBox="0 0 120 120" className="w-44 h-44">
        {Array.from({ length: 48 }).map((_, i) => {
          const a = -120 + (i / 47) * 240;
          const frac = i / 47;
          const [x1, y1] = polar(60, 60, 46, a);
          const [x2, y2] = polar(60, 60, 50, a);
          const color = frac < 0.55 ? "#3f9e5f" : frac < 0.8 ? "#c9a63c" : "#c0392b";
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="1.6" opacity="0.9" />;
        })}
        {GAUGE_TICKS.map((t) => {
          const a = -120 + (t / GAUGE_MAX) * 240;
          const [tx, ty] = polar(60, 60, 40, a);
          return (
            <text key={t} x={tx} y={ty + 2} textAnchor="middle" fontSize="7" fill="#c9a63c" opacity="0.85">
              {t}
            </text>
          );
        })}
        <line
          x1={60}
          y1={60}
          x2={nx}
          y2={ny}
          stroke="#e8e6e3"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="60" cy="60" r="3" fill="#c9a63c" />
        <text x="60" y="82" textAnchor="middle" fontSize="13" fill="#e8e6e3" fontWeight="bold">
          {Math.round(clamped)}
        </text>
        <text x="60" y="92" textAnchor="middle" fontSize="6" fill="#8a8781">
          / 30 min
        </text>
      </svg>
      <div className="flex items-center gap-1.5 -mt-3">
        <span className={`w-2 h-2 rounded-full ${active ? "bg-green-500" : "bg-white/25"}`} />
        <span className="text-sm text-gold/90 font-serif">{label}</span>
      </div>
    </div>
  );
}

export default function NorthflankPage() {
  const { data: system } = useQuery<SystemInfo>({
    queryKey: ["/api/system"],
    refetchInterval: 15_000,
  });

  const limiterMutation = useMutation({
    mutationFn: async (minutes: number) => {
      await apiRequest("PATCH", "/api/state", { selfPromptIntervalOverride: minutes });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/system"] }),
  });

  const paused = system?.selfPromptPaused === 1;
  const killed = system?.apiKillSwitch === 1;
  const pingsPer30Min =
    system && system.pingIntervalMs > 0 && !paused && !killed
      ? (30 * 60_000) / system.pingIntervalMs
      : 0;
  const pingMinutes = system && system.pingIntervalMs > 0 ? Math.round(system.pingIntervalMs / 60_000) : 0;

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-black via-[#0d0a06] to-black">
      <div className="max-w-2xl mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Link
            href="/"
            className="p-2 rounded-lg text-white/50 hover:text-gold hover:bg-white/5 transition-colors"
            data-testid="link-northflank-home"
            title="Home"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Server className="w-6 h-6 text-gold/80" />
          <h1 className="font-serif text-2xl text-gold" data-testid="text-northflank-title">Northflank</h1>
        </div>

        {/* Rate limits */}
        <div className="border border-white/10 rounded-2xl bg-black/50 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <GaugeIcon className="w-4 h-4 text-gold" />
            <h2 className="text-gold font-serif text-lg">Rate Limits</h2>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-8">
            <Gauge value={pingsPer30Min} label="Ash" active={!paused && !killed} />
            <div className="text-sm text-white/60 space-y-2 min-w-[220px]">
              <p data-testid="text-ping-rate">
                Ping rate:{" "}
                <span className="text-white">
                  {killed
                    ? "bridge off (kill switch)"
                    : paused
                    ? "paused"
                    : pingMinutes > 0
                    ? `every ${pingMinutes} min (${pingsPer30Min.toFixed(1)} / 30 min)`
                    : "off"}
                </span>
              </p>
              <label className="block">
                <span className="text-xs text-white/40">Limiter — interval override (minutes, 0 = status-based)</span>
                <input
                  type="number"
                  min={0}
                  key={system?.pingIntervalOverrideMinutes ?? 0}
                  defaultValue={system?.pingIntervalOverrideMinutes ?? 0}
                  onBlur={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 0 && v !== (system?.pingIntervalOverrideMinutes ?? 0)) {
                      limiterMutation.mutate(v);
                    }
                  }}
                  className="w-full mt-1 bg-black/60 border border-white/15 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-gold/40"
                  data-testid="input-limiter"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Build info */}
        <div className="border border-white/10 rounded-2xl bg-black/50 p-6">
          <h2 className="text-gold font-serif text-lg mb-3">Build</h2>
          <div className="text-sm text-white/60 space-y-1.5">
            <p data-testid="text-build-name">
              Current build: <span className="text-white font-mono">{system?.buildName || "..."}</span>
            </p>
            <p data-testid="text-build-status">
              Ash status: <span className="text-white">{system?.status || "..."}</span>
            </p>
            <p data-testid="text-build-heartbeat">
              Last heartbeat:{" "}
              <span className="text-white">
                {system?.lastHeartbeat
                  ? new Date(system.lastHeartbeat).toLocaleString("en-US", {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
                      timeZone: "America/New_York",
                    }) + " EST"
                  : "never"}
              </span>
            </p>
            <p data-testid="text-build-tokens">
              Tokens used: <span className="text-white">{system?.tokensUsed?.toLocaleString() ?? "..."}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
