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
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-zinc-100">
      <main className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
        <h1 className="text-2xl font-semibold">Welcome back</h1>
        <p className="mt-2 text-zinc-300">Sign in to access your FEH barracks.</p>
        <div className="mt-6">
          <AuthForm />
        </div>
      </main>
    </div>
  );
}
