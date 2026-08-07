import { REPO } from "@/lib/constants"

export async function getRepoStars(): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
      next: { revalidate: 3600 },
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "taskflow-landing",
      },
    })

    if (!res.ok) {
      return null
    }

    const data = (await res.json()) as { stargazers_count?: number }
    return typeof data.stargazers_count === "number"
      ? data.stargazers_count
      : null
  } catch {
    return null
  }
}

export function formatStars(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`
  }
  return String(count)
}
