/**
 * OnboardingGate — role-based first-run onboarding (V4).
 *
 * Flow:
 *   1. Identify: user enters their email (login identity).
 *   2. Role: student / working professional / business owner.
 *   3. Features: select ONLY the modules relevant to their work.
 *
 * The saved profile (a) injects a role persona into Yantri's system
 * instruction and (b) gates which tools Gemini is offered, so the assistant
 * only surfaces capabilities the user actually chose. Existing API-key gate
 * still runs first via main.tsx composition.
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  GraduationCap,
  Briefcase,
  Store,
  Mail,
  User,
  Loader2,
  Check,
  ChevronRight,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { API_BASE } from "../lib/config";
import {
  ROLE_FEATURES,
  ROLE_LABELS,
  type UserRole,
} from "../lib/profileTypes";

type Phase = "checking" | "welcome" | "email" | "role" | "features" | "done";

const ROLE_ICONS = {
  student: GraduationCap,
  professional: Briefcase,
  business_owner: Store,
};

const ROLE_TAGLINES: Record<UserRole, string> = {
  student: "Schedules, assignments, exam prep & study plans",
  professional: "Meetings, emails, projects & productivity",
  business_owner: "Inventory, customers, suppliers & accounts",
};

export function OnboardingGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/profile`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        if (data && data.email && data.role) {
          setPhase("done");
          setEmail(data.email);
          setName(data.name || "");
          setRole(data.role);
          setSelected(data.features || []);
        } else {
          setPhase("welcome");
        }
      } catch {
        if (!cancelled) setPhase("welcome");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleFeature(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    );
  }

  async function save() {
    if (!role) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, role, features: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save your profile.");
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  function restart() {
    setPhase("email");
    setSelected([]);
    setRole(null);
  }

  if (phase === "done") return <>{children}</>;

  const steps = ["Email", "Role", "Features"];
  const stepIndex = phase === "email" ? 0 : phase === "role" ? 1 : 2;

  const catalog = role ? ROLE_FEATURES[role] : [];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#050509] text-white">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[420px] w-[420px] rounded-full bg-indigo-700/20 blur-[130px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full bg-cyan-700/15 blur-[150px]" />

      <div className="relative z-10 w-full max-w-xl px-6 py-10">
        {/* Progress steps */}
        {phase !== "welcome" && (
          <div className="mb-8 flex items-center justify-center gap-2">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${
                    i < stepIndex
                      ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                      : i === stepIndex
                        ? "border-cyan-400 text-cyan-300"
                        : "border-white/15 text-slate-500"
                  }`}
                >
                  {i < stepIndex ? <Check size={12} /> : i + 1}
                </div>
                <span
                  className={`text-[10px] font-mono uppercase tracking-widest ${
                    i <= stepIndex ? "text-cyan-300" : "text-slate-600"
                  }`}
                >
                  {s}
                </span>
                {i < steps.length - 1 && <div className="h-px w-6 bg-white/10" />}
              </div>
            ))}
          </div>
        )}

        {phase === "welcome" && (
          <div className="text-center">
            <Sparkles className="mx-auto mb-4 text-cyan-300" size={40} />
            <h1 className="font-display text-3xl font-light tracking-wide">
              Welcome to YANTRI
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-400">
              Before we begin, I'd like to know who you are and what you do — so I
              can offer only the capabilities that matter to your work. No clutter,
              no irrelevant tools.
            </p>
            <button
              onClick={() => setPhase("email")}
              className="mt-8 inline-flex items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-8 py-3 text-sm font-medium text-cyan-200 transition hover:bg-cyan-500/20"
            >
              Get Started <ChevronRight size={16} />
            </button>
          </div>
        )}

        {phase === "email" && (
          <div>
            <h2 className="font-display text-2xl font-light">Identify yourself</h2>
            <p className="mt-2 text-sm text-slate-400">
              Your email keeps your schedules, notes and business data organised
              under one identity.
            </p>
            <div className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-1.5 flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-cyan-500">
                  <Mail size={12} /> Email
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400/60"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-cyan-500">
                  <User size={12} /> Name <span className="text-slate-600">(optional)</span>
                </span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="What should I call you?"
                  className="w-full rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400/60"
                />
              </label>
            </div>
            <button
              onClick={() => email.includes("@") && setPhase("role")}
              disabled={!email.includes("@")}
              className="mt-6 inline-flex items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-6 py-3 text-sm font-medium text-cyan-200 transition enabled:hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue <ChevronRight size={16} />
            </button>
          </div>
        )}

        {phase === "role" && (
          <div>
            <h2 className="font-display text-2xl font-light">What do you do?</h2>
            <p className="mt-2 text-sm text-slate-400">
              I'll tailor my toolkit to match. You can change this anytime in
              Settings.
            </p>
            <div className="mt-6 space-y-3">
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => {
                const Icon = ROLE_ICONS[r];
                const active = role === r;
                return (
                  <button
                    key={r}
                    onClick={() => {
                      setRole(r);
                      setSelected([]);
                    }}
                    className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${
                      active
                        ? "border-cyan-400/60 bg-cyan-500/10"
                        : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]"
                    }`}
                  >
                    <div
                      className={`rounded-xl p-2.5 ${
                        active ? "bg-cyan-500/20 text-cyan-300" : "bg-white/5 text-slate-400"
                      }`}
                    >
                      <Icon size={22} />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{ROLE_LABELS[r]}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{ROLE_TAGLINES[r]}</div>
                    </div>
                    {active && <Check size={18} className="text-cyan-300" />}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => role && setPhase("features")}
              disabled={!role}
              className="mt-6 inline-flex items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-6 py-3 text-sm font-medium text-cyan-200 transition enabled:hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Choose features <ChevronRight size={16} />
            </button>
          </div>
        )}

        {phase === "features" && role && (
          <div>
            <h2 className="font-display text-2xl font-light">
              Select your features
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Only the modules you pick will be available — nothing else. You can
              add more later in Settings.
            </p>
            <div className="mt-5 max-h-[46vh] space-y-2.5 overflow-y-auto pr-1">
              {catalog.map((f) => {
                const active = selected.includes(f.id);
                return (
                  <button
                    key={f.id}
                    onClick={() => toggleFeature(f.id)}
                    className={`flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition ${
                      active
                        ? "border-cyan-400/50 bg-cyan-500/10"
                        : "border-white/10 bg-white/[0.03] hover:border-white/25"
                    }`}
                  >
                    <div
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                        active ? "border-cyan-400 bg-cyan-500/30" : "border-white/20"
                      }`}
                    >
                      {active && <Check size={12} className="text-cyan-200" />}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{f.label}</div>
                      <div className="mt-0.5 text-xs leading-relaxed text-slate-500">
                        {f.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {error && (
              <p className="mt-3 text-xs text-rose-400">{error}</p>
            )}
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-6 py-3 text-sm font-medium text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-40"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {saving ? "Saving..." : "Finish setup"}
              </button>
              <button
                onClick={() => setPhase("role")}
                className="text-xs text-slate-500 underline hover:text-slate-300"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Re-run entry point when profile exists */}
        {phase === "welcome" && role && null}
        <button
          onClick={restart}
          className="absolute right-0 top-0 hidden p-2 text-slate-600 hover:text-white"
          title="Redo onboarding"
        >
          <RotateCcw size={14} />
        </button>
      </div>
    </div>
  );
}
