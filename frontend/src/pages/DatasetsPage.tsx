import { ChevronRight, FileUp } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { createDataset, listDatasets, type DatasetSummary, type TestCasePayload } from "@/api/datasets"
import { TestCaseForm } from "@/components/TestCaseForm"
import { PageFrame } from "@/components/layout/page-frame"
import { PageHeader } from "@/components/layout/page-header"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { formatInt, formatShortDate } from "@/lib/format"


export function DatasetsPage() {
  const navigate = useNavigate()
  const active = useRef(false)
  const pending = useRef(false)
  const [datasets, setDatasets] = useState<DatasetSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [search, setSearch] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    active.current = true
    let current = true
    setIsLoading(true)
    setLoadError(null)
    listDatasets().then((result) => { if (current) setDatasets(result) })
      .catch((error: unknown) => { if (current) setLoadError(error instanceof Error ? error.message : "Could not load datasets.") })
      .finally(() => { if (current) setIsLoading(false) })
    return () => {
      current = false
      active.current = false
    }
  }, [reload])
  async function handleCreate(testCase: TestCasePayload) {
    if (!name.trim() || pending.current) return
    pending.current = true
    setIsCreating(true)
    setFormError(null)
    try {
      const created = await createDataset({ name: name.trim(), description: description.trim() || null, test_case: testCase })
      if (active.current) navigate(`/datasets/${created.id}`)
    } catch (error) {
      if (active.current) setFormError(error instanceof Error ? error.message : "Could not create dataset.")
    } finally {
      pending.current = false
      if (active.current) setIsCreating(false)
    }
  }
  const importLink = <Link to="/datasets/import" className={buttonVariants({ variant: "outline", size: "touch" })}>
    <FileUp aria-hidden="true" className="size-4" />Import CSV or JSON
  </Link>
  const visible = datasets.filter((item) => `${item.name} ${item.description ?? ""}`.toLowerCase().includes(search.toLowerCase()))
  const caseCount = datasets.reduce((sum, item) => sum + item.test_case_count, 0)
  return <PageFrame
    breadcrumbs={[{ label: "Datasets" }]}
    actions={importLink}
    mobileTitle="Datasets"
  >
    <div className="flex flex-wrap items-center justify-between gap-3">
      <PageHeader
        title="Datasets"
        metadata={<span className="font-mono">{formatInt(datasets.length)} {datasets.length === 1 ? "dataset" : "datasets"} · {formatInt(caseCount)} {caseCount === 1 ? "case" : "cases"}
        </span>}
      />
      <Field label="Search datasets" htmlFor="search-datasets" className="w-full md:max-w-64">
        <Input
          placeholder="Search datasets…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Field>
    </div>
    <div className="md:hidden">{importLink}
    </div>
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="min-w-0">
        <h2 className="sr-only">Saved datasets</h2>
        {isLoading ? <LoadingState label="Loading datasets…" /> : loadError ? <ErrorState message={loadError} onRetry={() => setReload((value) => value + 1)} /> : datasets.length === 0 ? <EmptyState
          title="No datasets yet"
          description="Create a dataset together with its first test case."
          action={importLink}
        /> : visible.length === 0 ? <EmptyState title="No datasets match this search" /> : <Table className="max-md:block md:min-w-[640px]" aria-label="Saved datasets">
          <TableHeader className="hidden bg-chrome md:table-header-group">
            <TableRow>
              <TableHead scope="col">Dataset</TableHead>
              <TableHead scope="col" className="w-16 text-right">Cases</TableHead>
              <TableHead scope="col" className="w-28">Updated</TableHead>
              <TableHead scope="col" className="w-36 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="max-md:block">
            {visible.map((item) => <TableRow key={item.id} className="relative max-md:block max-md:pb-3">
              <TableCell className="min-w-0 max-md:block max-md:pb-1 max-md:pr-10">
                <Link
                  className="text-body font-medium text-link after:absolute after:inset-0 md:after:hidden [overflow-wrap:anywhere]"
                  to={`/datasets/${item.id}`}
                >{item.name}
                </Link>
                <p className="line-clamp-2 text-caption text-fg-muted [overflow-wrap:anywhere]">{item.description || "No description"}
                </p>
                <ChevronRight
                  aria-hidden="true"
                  className="absolute right-4 top-1/2 size-4 -translate-y-1/2 text-fg-muted md:hidden"
                />
              </TableCell>
              <TableCell
                className="font-mono text-data md:text-right max-md:inline-block max-md:py-0 max-md:pl-4"
              >{formatInt(item.test_case_count)}
                <span className="md:hidden"> {item.test_case_count === 1 ? "case" : "cases"} ·</span>
              </TableCell>
              <TableCell
                className="font-mono text-data text-fg-muted md:whitespace-pre-line max-md:inline-block max-md:py-0"
              >{formatShortDate(item.updated_at)}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <div className="flex justify-end gap-2">
                  <Link to="/evaluations/new" className={buttonVariants({ variant: "ghost", size: "sm" })}>Evaluate</Link>
                  <Link to={`/datasets/${item.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Open</Link>
                </div>
              </TableCell>
            </TableRow>)}
          </TableBody>
        </Table>}

      </Card>
      <Card>
        <CardHeader>
          <h2 className="text-section">New dataset</h2>
          <p className="text-caption text-fg-muted">Starts with one complete test case. Have a file?{" "}
            <Link className="text-link" to="/datasets/import">Import it.</Link>
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <TestCaseForm
            formId="create-dataset"
            submitLabel="Create dataset"
            busy={isCreating}
            disabled={!name.trim()}
            disabledReason={!name.trim() ? "Still needs a name." : undefined}
            error={formError}
            onSubmit={handleCreate}
            fieldsLegend="First test case"
            beforeFields={
              <>
                <div className="space-y-1.5">
                  <label htmlFor="dataset-name" className="text-caption font-medium">Name</label>
                  <Input
                    id="dataset-name"
                    aria-describedby={!name.trim() ? "create-dataset-disabled-reason" : undefined}
                    value={name}
                    maxLength={120}
                    disabled={isCreating}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="dataset-description" className="text-caption font-medium">Description{" "}
                    <span className="text-fg-muted">Optional</span>
                  </label>
                  <Textarea
                    id="dataset-description"
                    value={description}
                    maxLength={500}
                    disabled={isCreating}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </div>
              </>
            }
          />
        </CardContent>
      </Card>
    </div>
  </PageFrame>
}
