import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"

export function ThemeToggle({
  variant = "desktop",
  className,
}: {
  variant?: "desktop" | "mobile"
  className?: string
}) {
  const { theme, setTheme } = useTheme()

  if (variant === "mobile") {
    const Icon = theme === "dark" ? Sun : Moon
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className={cn("shrink-0", className)}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        <Icon className="size-[18px]" aria-hidden="true" />
      </Button>
    )
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      className={cn("grid w-full grid-cols-2 gap-0.5 rounded-md border border-line-strong bg-control p-0.5", className)}
    >
      {(["dark", "light"] as const).map((value) => {
        const Icon = value === "dark" ? Moon : Sun
        return (
          <Button
            key={value}
            type="button"
            variant="ghost"
            size="xs"
            className={cn(
              "h-7 gap-1.5 rounded-sm px-2.5 text-caption text-fg-secondary",
              theme === value && "bg-hover text-fg",
            )}
            aria-pressed={theme === value}
            onClick={() => setTheme(value)}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {value === "dark" ? "Dark" : "Light"}
          </Button>
        )
      })}
    </div>
  )
}
