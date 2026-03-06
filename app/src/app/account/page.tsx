import { redirect } from "next/navigation";
import { AccountSettingsClient } from "@/components/account-settings-client";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/client";

type AccountPageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: string;
  }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AccountPage({ searchParams }: AccountPageProps) {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  const params = await searchParams;
  const notice = String(params.notice || "").trim();
  const tone = params.tone === "warn" ? "warn" : "success";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <AccountSettingsClient
      email={user.email ?? null}
      initialNotice={notice}
      initialTone={tone}
    />
  );
}
