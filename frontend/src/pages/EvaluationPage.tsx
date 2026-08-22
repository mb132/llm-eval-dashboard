import { AlertCircle, LoaderCircle, Play } from "lucide-react"
import { useState } from "react"

import { runEvaluation, type EvaluationResult } from "@/api/evaluations"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const MODEL = "gemma4:e4b"
const QUESTION = "What is the capital of France?"

export function EvaluationPage() {
  const [result, setResult] = useState<EvaluationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function handleRun() {
    setIsLoading(true)
    setError(null)
    try {
      setResult(await runEvaluation())
    } catch (caughtError) {
      setResult(null)
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The evaluation could not be completed.",
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="space-y-3">
        <Badge variant="secondary">Local evaluation</Badge>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            LLM Evaluation
          </h1>
          <p className="mt-2 text-muted-foreground">
            Run one prompt against your local Ollama model.
          </p>
        </div>
      </header>

      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>Test question</CardTitle>
            <Badge variant="outline">{MODEL}</Badge>
          </div>
          <CardDescription>
            This first evaluation uses a fixed prompt and question.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="rounded-lg bg-muted p-4 text-lg">{QUESTION}</p>
          <Button className="w-full sm:w-auto" disabled={isLoading} onClick={handleRun}>
            {isLoading ? (
              <>
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                Running evaluation…
              </>
            ) : (
              <>
                <Play className="mr-2 size-4" />
                Run Evaluation
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <div
          className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {result && <ResultCard result={result} />}
    </div>
  )
}

function ResultCard({ result }: { result: EvaluationResult }) {
  return (
    <Card className="shadow-sm" aria-live="polite">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Generated response</CardTitle>
          <Badge>{result.model}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-xl leading-relaxed">{result.response}</p>
        <dl className="grid grid-cols-1 gap-3 border-t pt-5 sm:grid-cols-3">
          <Metric label="Latency" value={`${result.latency_ms} ms`} />
          <Metric label="Input tokens" value={formatTokens(result.input_tokens)} />
          <Metric label="Output tokens" value={formatTokens(result.output_tokens)} />
        </dl>
      </CardContent>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  )
}

function formatTokens(value: number | null) {
  return value === null ? "Unavailable" : value.toLocaleString()
}
