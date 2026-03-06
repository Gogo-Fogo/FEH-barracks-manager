type UserLike = {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function sanitizeDisplayName(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 32) : "";
}

export function deriveDefaultDisplayName(user: UserLike) {
  const metadata = user?.user_metadata ?? {};
  const metadataCandidates = [
    metadata.display_name,
    metadata.full_name,
    metadata.name,
    metadata.user_name,
    metadata.preferred_username,
    metadata.nickname,
  ];

  for (const candidate of metadataCandidates) {
    const sanitized = sanitizeDisplayName(candidate);
    if (sanitized) return sanitized;
  }

  const emailPrefix = String(user?.email || "").split("@")[0] || "";
  const fromEmail = sanitizeDisplayName(emailPrefix);
  if (fromEmail) return fromEmail;

  return "Summoner";
}

