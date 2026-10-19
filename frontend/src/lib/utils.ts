import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Custom type-scale names must remain distinct from semantic text colors.
const mergeClasses = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["title", "section", "body", "caption", "overline", "metric-lg", "metric-md", "data", "data-sm"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return mergeClasses(clsx(inputs))
}
