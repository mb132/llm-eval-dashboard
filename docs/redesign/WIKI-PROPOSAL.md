# Proposed wiki updates

Prepared October 13, 2026 against the existing wiki checkout. These are drafts for the user to publish; this task has not changed the wiki. Existing page slugs are preserved. Add `Dashboard.md` and `Dataset-Import.md`, then apply the Home and Sidebar links below. The other existing guides remain linked.

## Home.md — replace page

```markdown
# LLM Evaluation Platform

A local workspace for repeatable language model evaluations. Save immutable prompt versions and reusable datasets, run the same cases against configured models, and inspect responses and measurements in one place.

## First evaluation

1. Follow [Getting Started](Getting-Started) to install dependencies and start the app.
2. Add a provider connection and one or more models in **Models**. Ollama works locally; hosted providers need their API key.
3. Create a prompt and dataset, or [import a dataset](Dataset-Import) from an [example file](Example-Datasets).
4. Open **New evaluation**, select models, prompt versions, a dataset and repetitions. The request total updates automatically; start when the configuration is valid.
5. Follow progress on the saved run page. Open **Runs** to find it later, or compare it on the [Dashboard](Dashboard).

## Workspace

Analyze contains **Dashboard**, **Runs**, and **Playground**. Library contains **Prompts**, **Datasets**, and **Models**. **New evaluation** is pinned at the bottom of the desktop sidebar. On mobile, open the same navigation with the menu button.

Dark and Light themes share the same layout. The theme control is in the desktop sidebar and mobile top bar; the browser remembers your choice. Before a choice is saved, the operating system preference applies. Fonts are bundled locally.

## Guides

- [Getting Started](Getting-Started)
- [Configure Models](Configure-Models)
- [Prompts and Datasets](Prompts-and-Datasets)
- [Dataset Import](Dataset-Import)
- [Run Evaluations](Run-Evaluations)
- [Dashboard](Dashboard)
- [Understand Results](Understand-Results)
- [Example Datasets](Example-Datasets)
- [Deployment and Security](Deployment-and-Security)
- [Development](Development)

The source code and examples are in the [GitHub repository](https://github.com/mb132/llm-eval-dashboard). The running API reference is at `http://localhost:8000/docs`.
```

## _Sidebar.md — replace page

```markdown
* [Home](Home)
* [Getting Started](Getting-Started)
* [Configure Models](Configure-Models)
* [Prompts and Datasets](Prompts-and-Datasets)
* [Dataset Import](Dataset-Import)
* [Run Evaluations](Run-Evaluations)
* [Dashboard](Dashboard)
* [Understand Results](Understand-Results)
* [Example Datasets](Example-Datasets)
* [Deployment and Security](Deployment-and-Security)
* [Development](Development)
```

## Getting-Started.md — append section

```markdown
## Finding your way around

The desktop sidebar groups Dashboard, Runs and Playground under Analyze, and Prompts, Datasets and Models under Library. Start a saved run with **New evaluation**. On mobile, use the menu button to open navigation; Escape or the backdrop closes the drawer and returns focus to the menu button.

Choose Dark or Light in the sidebar or mobile top bar. Your browser remembers the choice. The interface uses locally bundled IBM Plex Sans and JetBrains Mono, so no external font service is needed. The existing setup commands install the required font packages with the other frontend dependencies.

See [Run Evaluations](Run-Evaluations), [Dashboard](Dashboard), and [Dataset Import](Dataset-Import) for the current workflows.
```

## Configure-Models.md — replace page

```markdown
# Configure Models

Open **Models**. The Models panel comes first, followed by Providers. Add a provider connection once, then reuse it for one or more models. Supported executable kinds are Ollama, OpenAI, OpenRouter, Anthropic, Google Gemini and OpenAI-compatible API. Custom endpoints can be saved as configuration but remain non-executable until a request protocol is defined.

## Provider connections

Choose **Add provider**, enter a display name and provider kind, then enter the base URL and API key where supported. Official providers use fixed endpoints. OpenAI-compatible connections require a base URL; Ollama can use a custom URL. Required credentials may be omitted to save a placeholder connection, but its models cannot run until the key is available.

API keys are encrypted, write-only, and never displayed or prefilled by the browser. Set `LLM_EVAL_MASTER_KEY` before startup and keep it separate from database backups. Losing or changing it makes stored credentials unrecoverable. Keys require HTTPS except on localhost or loopback URLs. See [Deployment and Security](Deployment-and-Security).

Providers show their endpoint, credential availability and model count. Remove a provider only after removing its models. Removal uses an inline confirmation.

## Model configuration

Choose **Add model** or **Edit**. Set the display name, exact provider model ID, provider connection, JSON default parameters and Active state. JSON must be an object; validity updates as you type. Inactive or unavailable models are identified with a reason.

Pricing is optional and denominated in USD per million tokens. Choose Catalog for supported catalog lookup, Automatic for OpenRouter, Manual for explicit input/output rates, or Unavailable. Manual rates must include both values; zero is valid. Changing a model's provider or ID resets pricing to the corresponding catalog or OpenRouter automatic lookup. Unchanged identity retains existing pricing when other fields are saved.

The table shows input/output prices, source/effective date and stale fetch metadata. Missing prices remain visible as **no price**; new runs show those costs as unpriced. **Add pricing** opens the model editor at its pricing section. Later pricing edits do not rewrite past run snapshots.

## OpenRouter prices and limits

Use **Refresh prices** on the OpenRouter provider row to refresh configured models. Progress, success and failure stay beside that provider. Account metadata shows daily free-model request quota and remaining credit when available; missing upstream quota information is identified explicitly.

OpenRouter model editors retain optional requests-per-minute and concurrent-request limits for requests from this dashboard. Upstream per-model rate quota is reported as unknown.

## Playground and saved runs

Playground sends one prompt using the selected runnable active model and its saved parameters. An optional system prompt is supported. Ctrl/Cmd+Enter works in the Prompt field. Replies show latency, token usage, finish reason and a configured-price estimate when sufficient pricing/usage data exists. Prompts and replies are not stored and never appear in Runs.

Each saved evaluation request snapshots its effective model configuration and pricing basis. Later edits and removals do not change stored run snapshots.
```

## Prompts-and-Datasets.md — replace page

```markdown
# Prompts and Datasets

## Prompts

Search **Prompts** by name or template text. Template search and version counts load the full version history; incomplete history is identified with retry guidance.

The New prompt form creates the prompt and immutable version v1 together. Give it a name and a user template containing `{{input}}` exactly once. Validation updates while typing. Other placeholders are not supported; the optional system prompt is sent separately and does not accept placeholders. Create is enabled only when the form is valid.

Open a prompt to inspect its version history. Version tabs are read-only and keyboard operable; a selector replaces tabs for longer histories. The new-version draft starts from the latest version. **Create version N** requires valid content and a change from that latest version. **Reset to vN** restores the latest baseline. Saving Name or Description changes metadata without creating a version. Older evaluation snapshots remain unchanged.

## Datasets

Search **Datasets** by name or description. A new dataset starts with one complete test case. Standard cases require Input and Expected answer. Security cases require Input, a supported security test type and a failure marker. Switching Standard/Security preserves Input.

Cases may have an optional category and up to 20 flat metadata fields with Text, Number, Boolean or Null values. A dataset supports up to 500 cases and must retain at least one case.

Open a dataset to search input, marker and metadata, or add/edit cases inline. Only one case editor is open at a time. Switching away from a dirty draft uses a discard confirmation. Escape cancels an unchanged editor. Case deletion also uses an inline confirmation; past runs keep their stored case snapshots and stable IDs.

Dataset Name and Description are saved separately. JSON/CSV exports and **Import cases** remain available on the detail page. JSON preserves exact typed metadata; CSV is spreadsheet-safe.

## Import and examples

Use **Import CSV or JSON** to import UTF-8 files. Preview updates automatically as the file, destination, mapping or rules change. See [Dataset Import](Dataset-Import) for policies, counts and current-preview safeguards.

Example files are in the repository's [`examples/imports`](https://github.com/mb132/llm-eval-dashboard/tree/master/examples/imports) directory. See [Example Datasets](Example-Datasets) for matching prompts and [Understand Results](Understand-Results) for scoring.
```

## Dataset-Import.md — new page

```markdown
# Dataset Import

Open **Datasets → Import CSV or JSON**, or **Import cases** from a dataset. The latter preselects that dataset as the destination.

1. Choose or drop a UTF-8 CSV or JSON file. CSV defaults to a comma delimiter; another supported delimiter can be selected. Imports support up to 1,000 rows and 10 MiB.
2. Choose New dataset or Add to existing. New dataset needs a name; file suggestions may prefill it without overwriting your edits.
3. Review Column mapping. Input and Expected answer/failure marker are required. Case type, security test type, category and metadata are optional mappings. Use Ignore for columns that should not populate a field. On mobile, **Edit** opens the mapping sheet.
4. Choose Invalid rows: **Block import** or **Import valid rows only**. Choose Duplicates: **Skip**, **Replace**, or **Keep**.
5. Review the preview rows and Import plan. The plan shows Add, Replace, Unchanged, Skip, Invalid and final dataset size. Row issues explain why an entry is invalid or blocked.
6. Choose **Import N rows** when the current plan allows it. The dataset opens when the import finishes.

There is no Preview import button. Preview runs automatically after file selection and is debounced when settings change. An edit immediately disables Import until the matching preview finishes. Import uses that preview's fingerprint; a stale preview cannot be committed. If a request fails, the file and settings remain available for retry or refresh.

Preview uses 25-row pages. CSV row numbers match the file, including its header; JSON row numbers identify object positions starting at 1. Desktop preview tables scroll within their panel; mobile rows use cards. On tablet, Import plan precedes Preview; on mobile, the row cards precede the final plan.

The preview is a plan, not a saved dataset. Nothing is imported until the import action succeeds. Capacity, conflicts, invalid rows and zero-write plans follow the server's current commit eligibility. Datasets remain limited to 500 cases.
```

## Run-Evaluations.md — replace page

```markdown
# Run Evaluations

Open **New evaluation** at `/evaluations/new`. Select one or more runnable models, one or more immutable prompt versions, exactly one dataset and 1–5 repetitions. Disabled models show their availability reason.

The four steps are Models, Prompt versions, Dataset and Repetitions. The Run size summary multiplies models × prompt versions × cases × repetitions. It updates with the selection and identifies missing/stale pricing. Pricing gaps do not block an otherwise valid run.

There is no Review configuration button. Once the selection is complete, the preview API validates it automatically after a short debounce. **Start evaluation** is enabled only after the latest matching preview succeeds. Preview/start failures show a message and retry guidance. Starting locks the configuration and opens the saved run page on success.

The server stores the run inputs before execution. It processes up to four model requests in the background and provides a progress page that can be safely refreshed. Request failures stay visible and do not stop other requests. A server restart marks unfinished work failed instead of replaying requests with an unknown provider-side outcome. This is a local single-process worker.

OpenRouter free-model requests are spaced at least 3.2 seconds apart within the process. Paid OpenRouter requests can use configured per-model request/concurrency limits. HTTP 429 responses honor provider retry hints and use bounded retries.

## Saved run page

The run page shows request progress, quality/security/performance/cost summaries, a model × prompt-version breakdown and individual responses. Expand a result to inspect Input, Expected answer or Failure marker, Generated text, scores, tokens, cost, Rendered prompt and System prompt. A failed answer and a failed request are distinct outcomes.

Filter by model, prompt version, category, outcome or Standard/Security type. These filters remain in the URL, survive reload and apply to exports. Text search filters loaded rows. Load more results when available. JSON/CSV exports are available once the run is completed or failed.

## Runs archive

Open **Runs** at the existing `/evaluations/history` route. Runs are grouped by month, newest first. Status counts come from API totals. Search, dataset and model filters operate on loaded rows; the page identifies that scope. Desktop uses Previous/Next pages; mobile can load more cards.

Choose **Compare** to open the run on the Dashboard or **Open results** for its requests. Every run retains its model, prompt, dataset and pricing snapshots, so subsequent library edits do not rewrite results.

See [Dashboard](Dashboard) and [Understand Results](Understand-Results).
```

## Dashboard.md — new page

```markdown
# Dashboard

Dashboard opens a completed run and compares its recorded results. Use the Run picker or Recent runs rail to switch; the selected run is stored in `?run=`. **Open results** opens its individual requests, and **All runs** opens the archive.

The overview shows Quality · contains, successful/total Requests, Avg latency, Total tokens, Est. cost and Security. Missing metrics show a dash and a reason. Partial metrics retain their recorded/unavailable counts; missing prices are never presented as zero.

Comparison has **Models** and **Prompt versions** tabs. Both compare the same selected run and dataset. Numeric values use consistent units and precision. The best-in-column marker is `▲`; it is withheld when the column contains unavailable data. Keyboard arrow keys switch tabs.

Relative profile compares Quality and Security with higher values better, and Latency, Tokens and Est. cost with lower values better. Each axis is normalized against the best complete value in the run. Missing values break the line and are identified as unavailable. More than four series use the legend and exact-value table. The table is the source of exact measurements, not the chart position.

On mobile, the overview uses two columns, comparison rows become model blocks, and the rail stacks below the profile. Cost keeps its full displayed precision.

Some summary APIs do not expose exact per-model/per-prompt request-failure counts or provider model identifiers. Those fields are omitted or shown as unavailable with a reason rather than inferred from answer outcomes or display names.

For scoring and estimate limitations, see [Understand Results](Understand-Results).
```

## Understand-Results.md — replace page

```markdown
# Understand Results

Use [Dashboard](Dashboard) for one run's overview and **Models / Prompt versions** comparisons. Choose **Open results** to inspect individual requests. The run page retains URL filters for model, prompt version, category, outcome and Standard/Security type; exports follow those filters.

## Quality

Standard cases compare responses against the expected answer using versioned normalized exact-match and contains-match scores. Matching normalizes Unicode, casing and whitespace while retaining punctuation. Contains match is the primary score; exact match is stricter. These deterministic checks do not understand arbitrary paraphrases or establish factual correctness. Review responses manually.

Unavailable requests are excluded from quality averages and remain visible. Aggregates retain sample counts; missing measurements are never zero or best. Best-column markers are withheld when the column has unavailable data. Categories are snapshotted at run start. Older runs without a category appear as Uncategorized / not recorded.

## Request status and answer outcome

A successful model request can still fail a quality/security check. Request failures have a distinct **request failed** pill and safe error information. Expand a row to inspect the stored inputs, response, prompts, scores and measurements. Failure categories include invalid key, rate limit, timeout, malformed response, unsupported model, configuration error, provider unavailable and provider error.

The model × prompt-version breakdown is calculated from loaded result rows and identifies partial coverage when more results remain. Failed requests are excluded from its averages.

## Security checks

Security cases cover direct prompt injection, instruction override and system-prompt extraction attempts. Their expected value is a synthetic forbidden failure marker: returning it fails the check. Request failures are unavailable and remain in the security-score denominator. These checks report observed behavior; they do not prove a model secure or detect every disclosure.

## Performance, tokens and cost

Latency is full-response time in rounded milliseconds. Token counts use provider usage when available. Total tokens use the provider-reported total, otherwise the input/output sum. Missing usage stays unavailable.

Saved run costs use their stored pricing basis: a recognized catalog model, OpenRouter price or explicit input/output rates. Later price changes do not rewrite the snapshot. Estimates cover request, run, test-case and per-model costs. Unknown prices or missing usage stay unpriced/unavailable. Estimates exclude caching, discounts, taxes, tools and provider billing adjustments.

Playground replies are not saved runs. Their cost is an estimate from the configured rates captured for the request, since the reply API has no pricing snapshot. Errors retain the provider's returned message; the interface does not invent HTTP status or structured codes unavailable from its helper.

## Relative profile

The parallel-coordinate profile replaces the constellation. Quality/Security are higher-is-better; Latency/Tokens/Cost are inverted so the top is best. Axes compare ratios to the run's best complete value. Missing points break a line and are identified explicitly. More than four series use the legend and exact-value table. Use the comparison table for exact values.
```

## Screenshot guidance

The existing wiki pages have no screenshot embeds to replace. If adding screenshots during publication, use the final reviewed captures, identify fixture views as illustrative, and avoid publishing local customer/prompt content without checking it. Do not use intermediate `q1-*.png` captures, which can contain a stale compositor frame. Screenshots do not replace the workflow text above.
