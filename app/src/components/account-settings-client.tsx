"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Provider, UserIdentity } from "@supabase/supabase-js";

type AccountSettingsClientProps = {
  email: string | null;
  initialNotice?: string;
  initialTone?: "success" | "warn";
};

type IdentityState = {
  identity_id: string;
  provider: string;
};

const OAUTH_PROVIDERS = [
  { provider: "google", label: "Google" },
  { provider: "discord", label: "Discord" },
] as const;

function normalizeNotice(value: string) {
  switch (value) {
    case "google-linked":
      return { tone: "success" as const, text: "Google is now linked to this account." };
    case "discord-linked":
      return { tone: "success" as const, text: "Discord is now linked to this account." };
    default:
      return value.trim()
        ? { tone: "success" as const, text: value.trim() }
        : null;
  }
}

function buildAccountOAuthRedirectUrl(provider: Provider) {
  const nextPath = `/account?notice=${encodeURIComponent(`${provider}-linked`)}&tone=success`;
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
}

export function AccountSettingsClient({
  email,
  initialNotice = "",
  initialTone = "success",
}: AccountSettingsClientProps) {
  const [identities, setIdentities] = useState<IdentityState[]>([]);
  const [identitiesLoading, setIdentitiesLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(normalizeNotice(initialNotice)?.text || null);
  const [messageTone, setMessageTone] = useState<"success" | "warn">(normalizeNotice(initialNotice)?.tone || initialTone);
  const [pendingProvider, setPendingProvider] = useState<Provider | null>(null);
  const [unlinkingIdentityId, setUnlinkingIdentityId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);

  async function loadIdentities() {
    setIdentitiesLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.getUserIdentities();

    if (error) {
      setMessageTone("warn");
      setMessage(error.message);
      setIdentities([]);
      setIdentitiesLoading(false);
      return;
    }

    const nextIdentities = (data?.identities || []).map((identity) => ({
      identity_id: identity.identity_id,
      provider: identity.provider,
    }));

    setIdentities(nextIdentities);
    setIdentitiesLoading(false);
  }

  useEffect(() => {
    loadIdentities();
  }, []);

  const linkedProviderSet = useMemo(() => new Set(identities.map((identity) => identity.provider)), [identities]);
  const canUnlink = identities.length > 1;

  const onLinkProvider = async (provider: Provider) => {
    setPendingProvider(provider);
    setMessage(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.linkIdentity({
        provider,
        options: {
          redirectTo: buildAccountOAuthRedirectUrl(provider),
        },
      });

      if (error) {
        setMessageTone("warn");
        setMessage(error.message);
      }
    } catch (error) {
      setMessageTone("warn");
      setMessage(error instanceof Error ? error.message : "Failed to start identity linking.");
    } finally {
      setPendingProvider(null);
    }
  };

  const onUnlinkProvider = async (identity: IdentityState) => {
    setUnlinkingIdentityId(identity.identity_id);
    setMessage(null);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.unlinkIdentity(identity as UserIdentity);

      if (error) {
        setMessageTone("warn");
        setMessage(error.message);
        return;
      }

      setMessageTone("success");
      setMessage(`${identity.provider[0].toUpperCase()}${identity.provider.slice(1)} was unlinked from this account.`);
      await loadIdentities();
    } catch (error) {
      setMessageTone("warn");
      setMessage(error instanceof Error ? error.message : "Failed to unlink identity.");
    } finally {
      setUnlinkingIdentityId(null);
    }
  };

  const onUpdatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    if (!password || password.length < 6) {
      setMessageTone("warn");
      setMessage("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setMessageTone("warn");
      setMessage("Password confirmation does not match.");
      return;
    }

    setPasswordPending(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setMessageTone("warn");
        setMessage(error.message);
        return;
      }

      setPassword("");
      setConfirmPassword("");
      setMessageTone("success");
      setMessage("Password updated. You can now use email/password sign-in with this account.");
    } catch (error) {
      setMessageTone("warn");
      setMessage(error instanceof Error ? error.message : "Failed to update password.");
    } finally {
      setPasswordPending(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 px-3 py-6 text-zinc-100 sm:px-4 sm:py-10">
      <main className="mx-auto w-full max-w-4xl rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Account Settings</p>
            <h1 className="mt-2 text-2xl font-semibold">Sign-in methods</h1>
            <p className="mt-2 text-sm text-zinc-300">
              Link or unlink Google and Discord for this FEH Barracks account, and set a password for email login.
            </p>
          </div>
          <Link
            href="/barracks"
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Back to barracks
          </Link>
        </header>

        {message ? (
          <p
            className={`mt-6 rounded-lg border p-3 text-sm ${
              messageTone === "warn"
                ? "border-amber-800 bg-amber-950/40 text-amber-200"
                : "border-emerald-800 bg-emerald-950/40 text-emerald-200"
            }`}
          >
            {message}
          </p>
        ) : null}

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <h2 className="text-lg font-semibold">Account</h2>
          <p className="mt-2 text-sm text-zinc-300">
            Signed in as {email || "unknown email"}
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Linking a new provider with a different email requires Supabase Auth `Allow manual linking` to be enabled.
          </p>
        </section>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Linked providers</h2>
              <p className="mt-2 text-sm text-zinc-300">
                Attach Google or Discord so you can sign in with whichever method is easiest.
              </p>
            </div>
            {identitiesLoading ? (
              <span className="text-xs text-zinc-500">Loading...</span>
            ) : (
              <span className="text-xs text-zinc-500">{identities.length} linked identit{identities.length === 1 ? "y" : "ies"}</span>
            )}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {OAUTH_PROVIDERS.map(({ provider, label }) => {
              const linked = linkedProviderSet.has(provider);
              const identity = identities.find((item) => item.provider === provider) || null;
              const isPending = pendingProvider === provider || unlinkingIdentityId === identity?.identity_id;

              return (
                <article key={provider} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-medium text-zinc-100">{label}</h3>
                      <p className="mt-1 text-xs text-zinc-500">
                        {linked ? "Currently linked to this account." : "Not linked yet."}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                        linked
                          ? "border-emerald-700 bg-emerald-950/50 text-emerald-300"
                          : "border-zinc-700 bg-zinc-900 text-zinc-400"
                      }`}
                    >
                      {linked ? "Linked" : "Available"}
                    </span>
                  </div>

                  <div className="mt-4">
                    {linked ? (
                      <button
                        type="button"
                        onClick={() => identity && onUnlinkProvider(identity)}
                        disabled={!identity || !canUnlink || isPending}
                        className="rounded-md border border-rose-800 px-3 py-2 text-sm text-rose-300 hover:bg-rose-950 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isPending ? "Working..." : "Unlink"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onLinkProvider(provider)}
                        disabled={isPending}
                        className="rounded-md border border-cyan-700 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-950 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isPending ? "Redirecting..." : `Link ${label}`}
                      </button>
                    )}
                  </div>

                  {linked && !canUnlink ? (
                    <p className="mt-3 text-[11px] text-zinc-500">
                      You need at least two linked identities before one can be removed.
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <h2 className="text-lg font-semibold">Password</h2>
          <p className="mt-2 text-sm text-zinc-300">
            Set or change your password for email login. This also works for accounts originally created with Google or Discord.
          </p>

          <form onSubmit={onUpdatePassword} className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-zinc-400" htmlFor="account-password">
                New password
              </label>
              <input
                id="account-password"
                type="password"
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-400" htmlFor="account-password-confirm">
                Confirm new password
              </label>
              <input
                id="account-password-confirm"
                type="password"
                minLength={6}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={passwordPending}
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {passwordPending ? "Updating..." : "Update password"}
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
