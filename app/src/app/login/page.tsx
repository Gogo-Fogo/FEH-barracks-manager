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

        <section className="order-2 overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(145deg,_rgba(255,255,255,0.08),_rgba(255,255,255,0.02))] shadow-[0_24px_70px_rgba(0,0,0,0.38)] md:min-h-[720px]">
          <div className="relative flex h-full min-h-[320px] flex-col justify-between overflow-hidden">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,_rgba(246,211,101,0.26),_transparent_30%),linear-gradient(110deg,_rgba(6,8,20,0.92)_0%,_rgba(6,8,20,0.72)_42%,_rgba(6,8,20,0.12)_100%)]" />
            <div className="relative z-10 max-w-sm p-6 md:p-10">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-100/75">
                Sharena - Hopeful Princess
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-white md:text-3xl">
                A brighter front door for the barracks.
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-200/85">
                Sharena reads as unmistakably Fire Emblem Heroes, welcoming, and a lot safer for portfolio screenshots than the current summer splash art.
              </p>
            </div>

            <img
              src="/api/fullbody/sharena___hopeful_princess?pose=portrait"
              alt="Sharena - Hopeful Princess full body art"
              className="pointer-events-none relative z-10 mx-auto h-[320px] w-full max-w-[640px] select-none object-contain object-bottom md:absolute md:inset-y-0 md:right-0 md:mx-0 md:h-full md:max-w-none md:object-right"
              loading="eager"
            />
          </div>
        </section>
      </main>
    </div>
  );
}
