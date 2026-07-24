import { StarIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { REPO_URL } from "@/lib/constants"
import { formatStars } from "@/lib/github"
import { cn } from "@/lib/utils"

type GitHubStarsProps = {
  stars: number | null
  className?: string
}

export function GitHubStars({ stars, className }: GitHubStarsProps) {
  const label =
    stars === null ? "Star on GitHub" : `${formatStars(stars)} stars on GitHub`

  return (
    <Badge
      variant="outline"
      render={
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
        />
      }
      className={cn(
        "h-7 gap-1.5 rounded-md border-border/80 bg-background/70 px-2.5 text-foreground backdrop-blur-sm transition-colors hover:bg-accent hover:text-accent-foreground",
        className
      )}
    >
      <StarIcon
        data-icon="inline-start"
        aria-hidden="true"
        className="fill-amber-400 text-amber-500"
      />
      <span className="font-mono tabular-nums">
        {stars === null ? "Star" : formatStars(stars)}
      </span>
    </Badge>
  )
}
