import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./lib/prisma";
import { isEmailAllowed } from "./lib/access-control";
import { logger } from "./lib/logger";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google],
  session: { strategy: "database" },
  callbacks: {
    async signIn({ profile, user }) {
      const googleProfile = profile as { email_verified?: boolean } | undefined;
      if (googleProfile?.email_verified === false) {
        logger.warn("auth_sign_in_blocked_unverified_email");
        return false;
      }
      const allowed = isEmailAllowed(user.email);
      if (!allowed) logger.warn("auth_sign_in_blocked_not_allowed", { emailDomain: user.email?.split("@")[1]?.toLowerCase() ?? null });
      return allowed;
    },
  },
  pages: {
    error: "/",
  },
});
