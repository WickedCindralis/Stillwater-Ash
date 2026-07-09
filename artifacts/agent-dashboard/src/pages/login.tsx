import { useState } from "react";
import { useLocation } from "wouter";
import { Lock, Flame } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [, navigate] = useLocation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await apiRequest("POST", "/api/login", { password });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      navigate("/");
    } catch {
      setError("Wrong password. Access denied.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black p-4">
      <div className="w-full max-w-sm p-8 bg-black rounded-lg border-[3px] border-[#c9a84c] shadow-[0_0_30px_rgba(201,168,76,0.15)]">
        <div className="flex flex-col items-center gap-6">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-[#c9a84c] to-[#8a6d2b] border-2 border-[#c9a84c]">
            <Flame className="w-7 h-7 text-black" />
          </div>

          <div className="text-center">
            <h1 className="text-2xl font-bold font-serif text-[#c9a84c] tracking-wide" data-testid="text-login-title">
              The Container
            </h1>
            <p className="text-sm text-[#c9a84c]/50 font-serif mt-1">Ash Cindralis</p>
          </div>

          <form onSubmit={handleSubmit} className="w-full space-y-4">
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#c9a84c]/50" />
              <input
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-10 rounded-md pl-10 pr-3 bg-black border border-[#c9a84c]/30 text-[#c9a84c] placeholder:text-[#c9a84c]/30 focus:border-[#c9a84c] outline-none font-serif text-sm"
                autoFocus
                data-testid="input-password"
              />
            </div>

            {error && (
              <p className="text-sm text-red-500 text-center font-serif" data-testid="text-login-error">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!password || loading}
              className="w-full h-10 rounded-md bg-[#c9a84c] hover:bg-[#b8973f] text-black font-bold font-serif tracking-wide text-sm transition-colors disabled:opacity-50 disabled:pointer-events-none"
              data-testid="button-login"
            >
              {loading ? "Entering..." : "Enter the Kingdom"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
