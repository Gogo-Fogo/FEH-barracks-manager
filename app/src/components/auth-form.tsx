"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { deriveDefaultDisplayName } from "@/lib/profile-defaults";

type Mode = "login" | "signup";

async function ensureProfileAfterAuth(
  supabase: ReturnType<typeof createClient>,
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null } | null | undefined
) {
  if (!user) return;

  const fallbackName = deriveDefaultDisplayName(user);

  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();

    if (String(profile?.display_name || "").trim()) {
      return;
    }

    await supabase.from("profiles").upsert({
      id: user.id,
      display_name: fallbackName,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Best-effort only; do not block auth flow on profile bootstrap.
  }
}

export function AuthForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [resetMode, setResetMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const title = useMemo(
    () => (mode === "login" ? "Sign in" : "Create account"),
    [mode]
  );

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    try {
      const supabase = createClient();

      if (resetMode) {
        const redirectTo = `${window.location.origin}/reset-password`;
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo,
        });

        if (error) {
          setMessage(error.message);
          return;
        }

        setMessage("Password reset email sent. Check your inbox.");
        setResetMode(false);
        return;
      }

      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          setMessage(error.message);
          return;
        }

        await ensureProfileAfterAuth(supabase, data.user);

        router.push("/barracks");
        router.refresh();
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      if (data.session?.user) {
        await ensureProfileAfterAuth(supabase, data.session.user);
      }

      setMessage(
        "Account created. If email confirmation is enabled, check your inbox before signing in."
      );
      setMode("login");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unexpected error";
      setMessage(text);
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-zinc-200">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-zinc-950/80 px-4 py-3 text-zinc-100 outline-none transition focus:border-amber-300/60 focus:bg-zinc-950 focus:ring-2 focus:ring-amber-300/20"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-zinc-200">
          Password
        </label>
        <input
          id="password"
          type="password"
          required={!resetMode}
          minLength={6}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-zinc-950/80 px-4 py-3 text-zinc-100 outline-none transition focus:border-amber-300/60 focus:bg-zinc-950 focus:ring-2 focus:ring-amber-300/20"
        />
      </div>

      {message ? (
        <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200">
          {message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-amber-300 px-4 py-3 font-semibold text-zinc-950 transition hover:bg-amber-200 disabled:opacity-60"
      >
        {pending ? "Working..." : resetMode ? "Send reset email" : title}
      </button>

      <button
        type="button"
        onClick={() => {
          setResetMode(false);
          setMode(mode === "login" ? "signup" : "login");
        }}
        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-zinc-200 transition hover:bg-white/10"
      >
        {mode === "login"
          ? "Need an account? Switch to sign up"
          : "Already have an account? Switch to sign in"}
      </button>

      <button
        type="button"
        onClick={() => setResetMode((v) => !v)}
        className="w-full rounded-2xl border border-white/10 bg-transparent px-4 py-3 text-zinc-300 transition hover:bg-white/5"
      >
        {resetMode ? "Back to login/signup" : "Forgot password?"}
      </button>
    </form>
  );
}
