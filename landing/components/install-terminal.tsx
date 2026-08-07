"use client"

import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { INSTALL_COMMAND } from "@/lib/constants"
import { cn } from "@/lib/utils"

type InstallTerminalProps = {
  className?: string
  id?: string
}

export function InstallTerminal({ className, id }: InstallTerminalProps) {
  const [copied, setCopied] = React.useState(false)
  const resetRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (resetRef.current) {
        clearTimeout(resetRef.current)
      }
    }
  }, [])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND)
      setCopied(true)
      if (resetRef.current) {
        clearTimeout(resetRef.current)
      }
      resetRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      id={id}
      className={cn(
        "animate-terminal-in overflow-hidden rounded-xl border border-slate-700/80 bg-[#0c1220] shadow-[0_24px_80px_-32px_rgba(15,23,42,0.55)]",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-700/70 px-4 py-2.5">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-slate-600" />
          <span className="size-2.5 rounded-full bg-slate-600" />
          <span className="size-2.5 rounded-full bg-slate-600" />
        </div>
        <p className="font-mono text-[11px] tracking-wide text-slate-400">
          install · taskflow
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 text-slate-300 hover:bg-slate-800 hover:text-white"
          aria-label={copied ? "Copied install command" : "Copy install command"}
        >
          {copied ? (
            <CheckIcon data-icon="inline-start" aria-hidden="true" />
          ) : (
            <CopyIcon data-icon="inline-start" aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? "Install command copied to clipboard." : ""}
      </span>
      <div className="overflow-x-auto px-4 py-5 sm:px-5">
        <pre
          className="font-mono text-[13px] leading-relaxed text-slate-100 sm:text-sm"
          translate="no"
        >
          <code>
            <span className="text-cyan-400/90">$</span>{" "}
            <span>{INSTALL_COMMAND}</span>
            <span
              className="animate-cursor-blink ml-0.5 inline-block h-[1.05em] w-[0.55ch] translate-y-[0.15em] bg-cyan-300/90 align-baseline"
              aria-hidden="true"
            />
          </code>
        </pre>
      </div>
    </div>
  )
}
