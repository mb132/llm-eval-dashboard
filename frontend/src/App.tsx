import { Route, Routes } from "react-router-dom"

import { AppShell } from "@/components/layout/app-shell"

import { DatasetDetailPage } from "@/pages/DatasetDetailPage"
import { DatasetImportPage } from "@/pages/DatasetImportPage"
import { DatasetsPage } from "@/pages/DatasetsPage"
import { DashboardPage } from "@/pages/DashboardPage"
import { EvaluationPage } from "@/pages/EvaluationPage"
import { EvaluationHistoryPage } from "@/pages/EvaluationHistoryPage"
import { EvaluationRunPage } from "@/pages/EvaluationRunPage"
import { ModelsPage } from "@/pages/models-page-v2"
import { PlaygroundPage } from "@/pages/playground-page"
import { PromptDetailPage } from "@/pages/PromptDetailPage"
import { PromptsPage } from "@/pages/PromptsPage"

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route index element={<DashboardPage />} />
        <Route path="evaluations/new" element={<EvaluationPage />} />
        <Route path="evaluations/history" element={<EvaluationHistoryPage />} />
        <Route path="evaluations/:evaluationId" element={<EvaluationRunPage />} />
        <Route path="prompts" element={<PromptsPage />} />
        <Route path="prompts/:promptId" element={<PromptDetailPage />} />
        <Route path="datasets" element={<DatasetsPage />} />
        <Route path="datasets/import" element={<DatasetImportPage />} />
        <Route path="datasets/:datasetId" element={<DatasetDetailPage />} />
        <Route path="playground" element={<PlaygroundPage />} />
        <Route path="models" element={<ModelsPage />} />
      </Routes>
    </AppShell>
  )
}
