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
    <div className="min-h-screen bg-zinc-950 px-4 text-zinc-100">
      <main className="mx-auto flex w-full max-w-7xl items-center gap-8 py-8 md:gap-12 md:py-12">
        <section className="w-full max-w-md">
          <h1 className="text-2xl font-semibold">Welcome back</h1>
          <p className="mt-2 text-zinc-300">Sign in to access your FEH barracks.</p>
          <div className="mt-6">
            <AuthForm />
          </div>
        </section>

        <section className="relative hidden flex-1 md:block">
          <img
            src="/api/fullbody/laegjarn___burning_sun?pose=portrait"
            alt="Laegjarn - Burning Sun full body art"
            className="pointer-events-none h-[86vh] w-full select-none object-contain object-right"
            loading="eager"
          />
        </section>
      </main>
    </div>
  );
}
