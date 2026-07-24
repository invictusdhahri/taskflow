import Image from "next/image"

import { GitHubStars } from "@/components/github-stars"
import { buttonVariants } from "@/components/ui/button"
import { REPO_URL } from "@/lib/constants"
import { cn } from "@/lib/utils"

type SiteHeaderProps = {
  stars: number | null
}

export function SiteHeader({ stars }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt=""
            width={28}
            height={28}
            className="size-7 rounded-md object-cover"
            priority
          />
          <span className="font-display text-base font-semibold tracking-tight text-foreground">
            TaskFlow
          </span>
        </a>
        <div className="flex items-center gap-2 sm:gap-3">
          <GitHubStars stars={stars} />
          <a
            href="#install"
            className={cn(buttonVariants({ size: "sm" }), "hidden sm:inline-flex")}
          >
            Install
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "hidden md:inline-flex"
            )}
          >
            GitHub
          </a>
        </div>
      </div>
    </header>
  )
}
