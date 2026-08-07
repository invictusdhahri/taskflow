import { REPO_URL } from "@/lib/constants"

export function SiteFooter() {
  return (
    <footer className="border-t border-border/70 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          TaskFlow — GitHub-native task-flow agent skill.{" "}
          <span className="text-foreground/80">MIT</span>
        </p>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          View on GitHub
        </a>
      </div>
    </footer>
  )
}
