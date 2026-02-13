"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

export function AuthForm() {
  const [mode, setMode] = useState<Mode>("login");
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

      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          setMessage(error.message);
          return;
        }

        router.push("/barracks");
        router.refresh();
        return;
      }

      const { error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        setMessage(error.message);
        return;
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
        <label htmlFor="email" className="mb-1 block text-sm text-zinc-300">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm text-zinc-300">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={6}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"
        />
      </div>

      {message ? <p className="text-sm text-zinc-300">{message}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400 disabled:opacity-60"
      >
        {pending ? "Working..." : title}
      </button>

      <button
        type="button"
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        className="w-full rounded-lg border border-zinc-700 px-4 py-2 text-zinc-300 hover:bg-zinc-800"
      >
        {mode === "login"
          ? "Need an account? Switch to sign up"
          : "Already have an account? Switch to sign in"}
      </button>
    </form>
  );
}
