import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";

export default async function Home() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <main className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-10 shadow-xl">
          <h1 className="text-3xl font-bold tracking-tight">FEH Barracks Manager</h1>
          <p className="mt-3 text-zinc-300">
            Web app scaffold is ready. Configure Supabase credentials in
            <code className="ml-1 text-zinc-200">app/.env.local</code> to enable auth.
          </p>
          <div className="mt-8">
            <Link
              href="/login"
              className="rounded-lg bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400"
            >
              Open login setup page
            </Link>
          </div>
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
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <main className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-10 shadow-xl">
        <h1 className="text-3xl font-bold tracking-tight">FEH Barracks Manager</h1>
        <p className="mt-3 text-zinc-300">
          Shared web app foundation is ready. Sign in to access your personal barracks.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-indigo-500 px-4 py-2 font-medium text-white hover:bg-indigo-400"
          >
            Login / Sign up
          </Link>
        </div>
      </main>
    </div>
  );
}
