"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setMessage(error.message);
        return;
      }

      setMessage("Password updated. You can now sign in with your new password.");
      setTimeout(() => {
        router.push("/login");
      }, 800);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unexpected error";
      setMessage(text);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <main className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
        <h1 className="text-2xl font-semibold">Reset password</h1>
        <p className="mt-2 text-sm text-zinc-300">
          Enter a new password for your account.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="new-password" className="mb-1 block text-sm text-zinc-300">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              minLength={6}
              required
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
            {pending ? "Working..." : "Update password"}
          </button>

          <Link
            href="/login"
            className="block w-full rounded-lg border border-zinc-700 px-4 py-2 text-center text-zinc-300 hover:bg-zinc-800"
          >
            Back to login
          </Link>
        </form>
      </main>
    </div>
  );
}
