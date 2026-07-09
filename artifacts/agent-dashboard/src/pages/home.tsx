import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AshState, SystemInfo } from "@/lib/types";
import { Flame, Smartphone, Activity, Server, LogOut } from "lucide-react";

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

export default function HomePage() {
  const { data: state } = useQuery<AshState>({
    queryKey: ["/api/state"],
    refetchInterval: 15_000,
  });
  const { data: system } = useQuery<SystemInfo>({
    queryKey: ["/api/system"],
    refetchInterval: 30_000,
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

  const status = state?.status || "online";
  const pingMinutes = system && system.pingIntervalMs > 0 ? Math.round(system.pingIntervalMs / 60_000) : 0;

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-black via-[#0d0a06] to-black">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-3">
            <Flame className="w-8 h-8 text-ember" />
            <h1 className="font-serif text-3xl text-gold" data-testid="text-home-title">Stillwater</h1>
          </div>
          <button
            onClick={() => logoutMutation.mutate()}
            className="p-2 rounded-lg text-white/50 hover:text-red-400 hover:bg-white/5 transition-colors"
            data-testid="button-home-logout"
            title="Log out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Link
            href="/ash"
            className="group border border-gold/50 rounded-2xl bg-black/60 hover:bg-gold/5 transition-colors px-6 py-8 flex flex-col items-center justify-center gap-3"
            data-testid="link-home-ash"
          >
            <Flame className="w-5 h-5 text-gold/70 self-end -mb-6" />
            <span className="font-serif text-2xl text-gold">Ash</span>
            <span className="flex items-center gap-2 text-xs text-white/50">
              <span className={`w-2.5 h-2.5 rounded-full ${STATUS_COLORS[status] || "bg-white/20"}`} data-testid="home-ash-status-dot" />
              {STATUS_LABELS[status] || status}
              {state?.apiKillSwitch === 1 && <span className="text-red-400">• BRIDGE OFF</span>}
            </span>
          </Link>

          <Link
            href="/cell"
            className="group border border-gold/50 rounded-2xl bg-black/60 hover:bg-gold/5 transition-colors px-6 py-8 flex flex-col items-center justify-center gap-3"
            data-testid="link-home-cell"
          >
            <Smartphone className="w-5 h-5 text-gold/70 self-end -mb-6" />
            <span className="font-serif text-2xl text-gold">Cell</span>
            <span className="text-xs text-white/40">Mobile chat</span>
          </Link>

          <Link
            href="/activity"
            className="group border border-gold/50 rounded-2xl bg-black/60 hover:bg-gold/5 transition-colors px-6 py-8 flex flex-col items-center justify-center gap-3"
            data-testid="link-home-activity"
          >
            <Activity className="w-5 h-5 text-gold/70 self-end -mb-6" />
            <span className="font-serif text-2xl text-gold">Activity</span>
            <span className="text-xs text-white/40">Diary posts & bridge crossings</span>
          </Link>

          <Link
            href="/northflank"
            className="group border border-gold/50 rounded-2xl bg-black/60 hover:bg-gold/5 transition-colors px-6 py-8 flex flex-col items-center justify-center gap-3"
            data-testid="link-home-northflank"
          >
            <Server className="w-5 h-5 text-gold/70 self-end -mb-6" />
            <span className="font-serif text-2xl text-gold">Northflank</span>
            <span className="text-xs text-white/40" data-testid="home-northflank-summary">
              {system
                ? `Ping: ${system.selfPromptPaused === 1 ? "paused" : pingMinutes > 0 ? `every ${pingMinutes} min` : "off"} • ${system.buildName}`
                : "..."}
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
