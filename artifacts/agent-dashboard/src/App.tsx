import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Route, Switch, Redirect, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import LoginPage from "./pages/login";
import ChatPage from "./pages/chat";
import CellPage from "./pages/cell";

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
  return <>{children}</>;
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
      <Route>
        <AuthGate>
          <ChatPage />
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
