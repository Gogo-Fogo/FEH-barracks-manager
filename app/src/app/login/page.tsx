import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";

export default async function LoginPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
        <main className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
          <h1 className="text-2xl font-semibold">Supabase not configured yet</h1>
          <p className="mt-3 text-zinc-300">
            Copy <code className="text-zinc-200">app/.env.example</code> to
            <code className="ml-1 text-zinc-200">app/.env.local</code> and fill in
            your Supabase URL + anon key.
          </p>
        </main>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/barracks");
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(245,197,66,0.15),_transparent_28%),linear-gradient(135deg,_#050816_0%,_#0b1222_48%,_#06070c_100%)] px-4 text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,_rgba(255,255,255,0.04),_transparent_28%,_transparent_72%,_rgba(255,209,102,0.08))]" />

      <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center gap-6 py-8 md:grid md:grid-cols-[minmax(0,420px)_minmax(0,1fr)] md:items-center md:gap-8 md:py-12">
        <section className="order-1 rounded-[28px] border border-white/10 bg-zinc-950/65 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.45)] backdrop-blur md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/85">
            FEH Barracks
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Welcome back
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-6 text-zinc-300">
            Sign in or create an account to keep your FEH barracks synced across desktop and mobile.
          </p>

          <div className="mt-7">
            <AuthForm />
          </div>
        </section>

        <section className="order-2 relative hidden min-h-[720px] overflow-visible md:block">
          <div className="pointer-events-none absolute left-[8%] top-[16%] h-52 w-52 rounded-full bg-amber-200/12 blur-3xl" />
          <div className="pointer-events-none absolute right-[12%] top-[12%] h-72 w-72 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="pointer-events-none absolute bottom-[12%] right-[8%] h-64 w-64 rounded-full bg-amber-100/6 blur-3xl" />
          <img
            src="/api/fullbody/sharena___hopeful_princess?pose=portrait"
            alt="Sharena - Hopeful Princess full body art"
            className="pointer-events-none absolute inset-y-0 right-0 h-full w-full select-none object-contain object-right drop-shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
            loading="eager"
          />
        </section>
      </main>
    </div>
  );
}
