import type { Metadata } from "next"
import type { ReactNode } from "react"
import { Bricolage_Grotesque, IBM_Plex_Mono, Source_Sans_3 } from "next/font/google"

import { ThemeProvider } from "@/components/theme-provider"
import { SITE_URL } from "@/lib/constants"
import { cn } from "@/lib/utils"

import "./globals.css"

const fontSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-sans",
})

const fontDisplay = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
})

const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "TaskFlow — Structured GitHub boards for AI agents",
    template: "%s · TaskFlow",
  },
  description:
    "A GitHub-native agent skill that bootstraps projects, audits backlogs, and creates implementation-ready issues. Install once, paste into any AI coding tool.",
  openGraph: {
    title: "TaskFlow — Structured GitHub boards for AI agents",
    description:
      "Bootstrap, audit, and ship implementation-ready GitHub issues from Cursor, Claude Code, Codex, and more.",
    url: SITE_URL,
    siteName: "TaskFlow",
    type: "website",
    images: [
      {
        url: "/logo.png",
        width: 900,
        height: 600,
        alt: "TaskFlow",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "TaskFlow — Structured GitHub boards for AI agents",
    description:
      "A GitHub-native agent skill. Copy one command. Paste into your AI tool.",
    images: ["/logo.png"],
  },
  alternates: {
    canonical: "/",
  },
  other: {
    "theme-color": "#f7f9fb",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontSans.variable,
        fontDisplay.variable,
        fontMono.variable
      )}
    >
      <body className="min-h-svh font-sans">
        <ThemeProvider attribute="class" forcedTheme="light" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
