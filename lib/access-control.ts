function splitEnvList(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowed(email?: string | null) {
  if (!email) return false;

  const normalizedEmail = email.toLowerCase();
  const allowedEmails = splitEnvList(process.env.ALLOWED_EMAILS);
  const allowedDomains = splitEnvList(process.env.ALLOWED_EMAIL_DOMAINS).map((domain) => domain.replace(/^@/, ""));

  if (allowedEmails.length === 0 && allowedDomains.length === 0) return true;
  if (allowedEmails.includes(normalizedEmail)) return true;

  const emailDomain = normalizedEmail.split("@")[1];
  return Boolean(emailDomain && allowedDomains.includes(emailDomain));
}

export function isAdminEmail(email?: string | null) {
  if (!email) return false;
  return splitEnvList(process.env.ADMIN_EMAILS).includes(email.toLowerCase());
}
