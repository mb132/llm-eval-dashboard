import { CheckCircle2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg shadow-lg">
        <CardHeader className="space-y-4">
          <Badge variant="secondary" className="w-fit gap-1.5">
            <CheckCircle2 className="size-3.5 text-emerald-600" />
            System ready
          </Badge>
          <div className="space-y-2">
            <CardTitle className="text-3xl tracking-tight">
              LLM Evaluation Platform
            </CardTitle>
            <CardDescription className="text-base">
              Frontend is running successfully. Backend status is not checked yet.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-1.5 w-full rounded-full bg-emerald-500/80" />
        </CardContent>
      </Card>
    </main>
  )
}
