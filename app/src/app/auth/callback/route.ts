import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureProfileRow } from "@/lib/ensure-profile";

function safeNextPath(value: string | null, fallback = "/barracks") {
  if (!value || !value.startsWith("/")) return fallback;
  return value;
}

function withMessage(origin: string, path: string, message: string) {
  const url = new URL(path, origin);
  url.searchParams.set("message", message);
  return url;
}

function resolveOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto =
    request.headers.get("x-forwarded-proto") || requestUrl.protocol.replace(":", "");

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return requestUrl.origin;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = resolveOrigin(request);
  const nextPath = safeNextPath(requestUrl.searchParams.get("next"), "/barracks");
  const code = requestUrl.searchParams.get("code");
  const errorDescription = requestUrl.searchParams.get("error_description");

  if (errorDescription) {
    return NextResponse.redirect(
      withMessage(origin, "/login", errorDescription)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      withMessage(origin, "/login", "OAuth sign-in did not return an authorization code.")
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(withMessage(origin, "/login", error.message));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await ensureProfileRow(supabase, user);
  }

  return NextResponse.redirect(new URL(nextPath, origin));
}
