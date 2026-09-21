import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { Link, Route, Switch, Redirect, Router as WouterRouter } from "wouter";
import { apiRequest, queryClient } from "./lib/queryClient";
import type { AshState, DiscordStatus } from "./lib/types";
import LoginPage from "./pages/login";
import HomePage from "./pages/home";
import ChatPage from "./pages/chat";
import CellPage from "./pages/cell";
import ActivityPage from "./pages/activity";
import NorthflankPage from "./pages/northflank";
import PersonaPage from "./pages/persona";
import HeraldPage from "./pages/herald";
import DiscordPage from "./pages/discord";
import PacketPage from "./pages/packet";
import StoryPage from "./pages/story";
import { Power } from "lucide-react";

function AuthGate({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useQuery<{ authenticated: boolean }>({
    queryKey: ["/api/auth/me"],
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-black">
        <div className="text-gold/60 font-serif text-xl animate-pulse">
          The Container...
        </div>
      </div>
    );
  }
  if (!data?.authenticated) {
    return <Redirect to="/login" />;
  }
  return (
    <div className="h-full flex flex-col">
      <StillwaterTopBar />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function StillwaterTopBar() {
  const { data: state } = useQuery<AshState>({
    queryKey: ["/api/state"],
    refetchInterval: 15_000,
  });
  const discordOff = state?.discordKillSwitch === 1;
  const switchMutation = useMutation({
    mutationFn: async (discordKillSwitch: number) => {
      const response = await apiRequest("PATCH", "/api/state", { discordKillSwitch });
      return (await response.json()) as AshState;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(["/api/state"], next);
      queryClient.setQueryData<DiscordStatus>(["/api/discord"], (current) =>
        current ? { ...current, discordKillSwitch: next.discordKillSwitch } : current,
      );
    },
  });

  const handleSwitch = () => {
    if (!state) return;
    if (discordOff && !window.confirm("Turn the Discord bridge back on? Ash may resume answering queued calls.")) {
      return;
    }
    switchMutation.mutate(discordOff ? 0 : 1);
  };

  return (
    <header className="shrink-0 h-12 px-4 sm:px-6 flex items-center justify-between border-b border-red-500/30 bg-black/90">
      <Link
        href="/"
        className="font-serif text-lg text-gold hover:text-gold-light transition-colors"
        data-testid="link-stillwater-topbar"
      >
        Stillwater
      </Link>
      <button
        onClick={handleSwitch}
        disabled={!state || switchMutation.isPending}
        aria-pressed={discordOff}
        aria-label={discordOff ? "Turn Discord bridge on" : "Turn Discord bridge off"}
        title={switchMutation.isError ? "Discord bridge switch failed — try again" : "Emergency Discord bridge switch"}
        className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-bold tracking-wide transition-colors ${
          discordOff
            ? "border-red-400/70 bg-red-500/25 text-red-200 hover:bg-red-500/35"
            : "border-red-500/50 bg-red-950/50 text-red-300 hover:bg-red-900/60"
        } disabled:cursor-wait disabled:opacity-60`}
        data-testid="button-topbar-discord-switch"
      >
        <Power className="h-3.5 w-3.5" />
        <span>DISCORD</span>
        <span className="rounded bg-red-500/20 px-1.5 py-0.5">{state ? (discordOff ? "OFF" : "ON") : "..."}</span>
      </button>
    </header>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/cell">
        <AuthGate>
          <CellPage />
        </AuthGate>
      </Route>
      <Route path="/ash">
        <AuthGate>
          <ChatPage />
        </AuthGate>
      </Route>
      <Route path="/herald">
        <AuthGate>
          <HeraldPage />
        </AuthGate>
      </Route>
      <Route path="/discord">
        <AuthGate>
          <DiscordPage />
        </AuthGate>
      </Route>
      <Route path="/persona">
        <AuthGate>
          <PersonaPage />
        </AuthGate>
      </Route>
      <Route path="/packet">
        <AuthGate>
          <PacketPage />
        </AuthGate>
      </Route>
      <Route path="/activity">
        <AuthGate>
          <ActivityPage />
        </AuthGate>
      </Route>
      <Route path="/northflank">
        <AuthGate>
          <NorthflankPage />
        </AuthGate>
      </Route>
      <Route path="/story">
        <AuthGate>
          <StoryPage />
        </AuthGate>
      </Route>
      <Route>
        <AuthGate>
          <HomePage />
        </AuthGate>
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
      </WouterRouter>
    </QueryClientProvider>
  );
}
