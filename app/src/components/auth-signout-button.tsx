"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AuthSignOutButton() {
  const router = useRouter();

  const onSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={onSignOut}
      className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
    >
      Sign out
    </button>
  );
}
