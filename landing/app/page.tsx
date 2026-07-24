import Image from "next/image"

import { GitHubStars } from "@/components/github-stars"
import { InstallTerminal } from "@/components/install-terminal"
import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import { buttonVariants } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { INSTALL_COMMAND, REPO_URL } from "@/lib/constants"
import { getRepoStars } from "@/lib/github"
import { cn } from "@/lib/utils"

const capabilities = [
  {
    title: "Bootstrap",
    body: "Stand up a repository, Project board, and MVP issues in one flow.",
  },
  {
    title: "Audit",
    body: "Deduplicate and clean an existing backlog so the board stays readable.",
  },
  {
    title: "Ship-ready issues",
    body: "File lists, acceptance criteria, relationships, and a safe write plan.",
  },
]

const steps = [
  {
    n: "01",
    title: "Install the skill",
    body: "Paste one command into your terminal. Works project-local or globally.",
  },
  {
    n: "02",
    title: "Invoke TaskFlow",
    body: "Ask your agent to run TaskFlow — Cursor, Claude Code, Codex, and more.",
  },
  {
    n: "03",
    title: "Approve the plan",
    body: "It proposes a versioned change plan and waits. Nothing writes until you continue.",
  },
]

const notItems = [
  "Not a hosted SaaS",
  "Not automatic issue spam",
  "Not locked to one AI tool",
]

export default async function Page() {
  const stars = await getRepoStars()

  return (
    <div
      id="top"
      className="relative min-h-svh overflow-x-clip bg-[radial-gradient(1200px_600px_at_50%_-10%,oklch(0.94_0.04_210),transparent_60%),linear-gradient(180deg,oklch(0.985_0.004_240),oklch(0.97_0.01_230)_40%,oklch(0.985_0.004_240))]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,oklch(0.55_0.02_250/0.04)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.55_0.02_250/0.04)_1px,transparent_1px)] bg-size-[48px_48px] mask-[radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
      />

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>

      <SiteHeader stars={stars} />

      <main id="main">
        <section className="relative mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pt-14 pb-16 sm:px-6 sm:pt-20 sm:pb-24">
          <div className="flex max-w-2xl flex-col gap-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-3">
                <Image
                  src="/logo.png"
                  alt=""
                  width={48}
                  height={48}
                  className="size-12 rounded-xl object-cover shadow-sm ring-1 ring-border/70"
                  priority
                />
                <p className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  TaskFlow
                </p>
              </div>
              <GitHubStars stars={stars} />
            </div>

            <div className="flex flex-col gap-4">
              <h1 className="font-display text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl sm:leading-[1.08]">
                A structured board on GitHub — so you know what you&apos;re doing.
              </h1>
              <p className="max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
                Agent skill that organizes tasks into implementation-ready GitHub
                issues and Projects. Copy once. Paste into any AI tool you use.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a href="#install" className={cn(buttonVariants({ size: "lg" }))}>
                Copy Install Command
              </a>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
              >
                View on GitHub
              </a>
            </div>
          </div>

          <InstallTerminal id="install" className="w-full max-w-3xl" />
        </section>

        <section className="relative border-y border-border/70 bg-background/60 py-20 backdrop-blur-sm">
          <div className="animate-reveal-up mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 sm:px-6">
            <div className="max-w-xl">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                What it does
              </h2>
              <p className="mt-3 text-muted-foreground">
                One skill for the full loop: from empty repo to a board you can
                actually work from.
              </p>
            </div>
            <ul className="grid gap-8 sm:grid-cols-3">
              {capabilities.map((item) => (
                <li key={item.title} className="flex flex-col gap-2">
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="relative py-20">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 sm:px-6">
            <div className="max-w-xl">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                How it works
              </h2>
              <p className="mt-3 text-muted-foreground">
                Three steps. No dashboard to learn. No account to create.
              </p>
            </div>
            <ol className="grid gap-8 sm:grid-cols-3">
              {steps.map((step) => (
                <li key={step.n} className="flex flex-col gap-3">
                  <span className="font-mono text-xs tracking-widest text-primary">
                    {step.n}
                  </span>
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    {step.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="relative border-y border-border/70 bg-background/60 py-20 backdrop-blur-sm">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 sm:px-6">
            <div className="max-w-xl">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                What it is not
              </h2>
              <p className="mt-3 text-muted-foreground">
                Independent, GitHub-native, and careful with your backlog.
              </p>
            </div>
            <ul className="flex max-w-2xl flex-col gap-0">
              {notItems.map((item, index) => (
                <li key={item}>
                  {index > 0 ? <Separator /> : null}
                  <p className="py-4 font-medium text-foreground">{item}</p>
                </li>
              ))}
            </ul>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              TaskFlow proposes a versioned change plan and waits for Continue /
              Refuse before any GitHub content write. Works with the open Agent
              Skills standard.
            </p>
          </div>
        </section>

        <section className="relative py-20 sm:py-24">
          <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-8 px-4 sm:px-6">
            <div className="max-w-xl">
              <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Paste this and go
              </h2>
              <p className="mt-3 text-muted-foreground">
                Same command. Copy it, run it, then ask your agent for TaskFlow.
              </p>
            </div>
            <InstallTerminal className="w-full max-w-3xl" />
            <p className="font-mono text-xs text-muted-foreground">
              {INSTALL_COMMAND}
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
