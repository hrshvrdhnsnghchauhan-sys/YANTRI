/**
 * AuthGate — authentication onboarding.
 *
 * Queries the backend (/api/auth/config). When auth is required it blocks the
 * app behind a login/register form until a valid token is present; when the
 * server has auth disabled it renders children immediately (local dev / tests).
 */
import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { LogIn, UserPlus, Loader2, ShieldCheck } from "lucide-react";
import { API_BASE } from "../lib/config";
import { getToken, setToken, setStoredUser } from "../lib/authStore";

type Phase = "checking" | "needsAuth" | "ready";

export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfgRes = await fetch(`${API_BASE}/api/auth/config`, { cache: "no-store" });
        const cfg = await cfgRes.json();
        if (cancelled) return;
        if (!cfg.authRequired) {
          setPhase("ready");
          return;
        }
        if (getToken()) {
          const meRes = await fetch(`${API_BASE}/api/auth/me`, { cache: "no-store" });
          if (meRes.ok) {
            setPhase("ready");
            return;
          }
        }
        setPhase("needsAuth");
      } catch {
        // Backend not reachable — assume auth is not the blocker and continue.
        if (!cancelled) setPhase("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body = mode === "login" ? { email, password } : { email, password, name };
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed.");
      setToken(data.token);
      setStoredUser(data.user);
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "ready") return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[#050509] text-white">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[420px] w-[420px] rounded-full bg-indigo-700/20 blur-[130px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full bg-cyan-700/15 blur-[150px]" />

      {phase === "checking" ? (
        <div className="flex flex-col items-center gap-4 text-white/60">
          <Loader2 className="h-7 w-7 animate-spin" />
          <span className="text-sm tracking-wide">Checking access…</span>
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="relative z-10 w-[min(92vw,440px)] rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-[0_30px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl"
        >
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/30 to-cyan-500/20 ring-1 ring-white/10">
              {mode === "login" ? (
                <LogIn className="h-6 w-6 text-indigo-200" />
              ) : (
                <UserPlus className="h-6 w-6 text-indigo-200" />
              )}
            </div>
            <h1 className="text-xl font-semibold tracking-tight">
              {mode === "login" ? "Sign in to YANTRI" : "Create your YANTRI account"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-white/55">
              This deployment requires an account before the assistant can be used.
            </p>
          </div>

          {mode === "register" && (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              className="mb-3 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20"
            />
          )}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            spellCheck={false}
            className="mb-3 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20"
          />
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "register" ? "Password (min 8 chars)" : "Password"}
            className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20"
          />

          {error && (
            <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300 ring-1 ring-red-500/20">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !email.trim() || !password}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Please wait…
              </>
            ) : mode === "login" ? (
              "Sign in"
            ) : (
              "Create account"
            )}
          </button>

          <div className="mt-5 flex items-center justify-between text-xs text-white/45">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Encrypted at rest
            </span>
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError(null);
              }}
              className="text-indigo-300 transition hover:text-indigo-200"
            >
              {mode === "login" ? "Create an account" : "I already have an account"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
