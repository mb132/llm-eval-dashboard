import { Database, FlaskConical, MessageSquareText } from "lucide-react"
import { NavLink, Route, Routes } from "react-router-dom"

import { EvaluationPage } from "@/pages/EvaluationPage"
import { EvaluationRunPage } from "@/pages/EvaluationRunPage"
import { DatasetDetailPage } from "@/pages/DatasetDetailPage"
import { DatasetsPage } from "@/pages/DatasetsPage"
import { PromptDetailPage } from "@/pages/PromptDetailPage"
import { PromptsPage } from "@/pages/PromptsPage"

const navigation = [
  { to: "/", label: "Evaluation", icon: FlaskConical, end: true },
  { to: "/prompts", label: "Prompts", icon: MessageSquareText, end: false },
  { to: "/datasets", label: "Datasets", icon: Database, end: false },
]

export default function App() {
  return (
    <main className="min-h-screen bg-background px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-5xl">
        <nav
          className="mb-10 flex flex-wrap items-center gap-2 border-b pb-4"
          aria-label="Primary navigation"
        >
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 ${
                  isActive
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <Routes>
          <Route index element={<EvaluationPage />} />
          <Route path="evaluations/:evaluationId" element={<EvaluationRunPage />} />
          <Route path="prompts" element={<PromptsPage />} />
          <Route path="prompts/:promptId" element={<PromptDetailPage />} />
          <Route path="datasets" element={<DatasetsPage />} />
          <Route path="datasets/:datasetId" element={<DatasetDetailPage />} />
        </Routes>
      </div>
    </main>
  )
}
