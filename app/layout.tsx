import type { Metadata } from "next";
import { auth } from "../auth";
import { AiAssistantChat } from "../components/AiAssistantChat";
import { getCurrentLocale } from "../lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bolão Copa 2026",
  description: "Palpites recreativos da Copa 2026",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  const locale = await getCurrentLocale();

  return (
    <html lang={locale}>
      <body>
        {children}
        {session?.user?.email && <AiAssistantChat locale={locale} variant="widget" />}
      </body>
    </html>
  );
}
