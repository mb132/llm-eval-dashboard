# Frontend redesign acceptance report

Reviewed October 13, 2026 on `feat/redesign-llm-eval`.

## Verification

- Lint and production build pass; all 356 tests in 16 files pass. All original tests remain; none are skipped or marked todo.
- No diff against `master` under `backend/`, `alembic/`, or `frontend/src/api/`.
- Only IBM Plex Sans and JetBrains Mono font packages were added. Fonts are shipped locally.
- The final TSX sweep finds no color literals, shadows, gradients, glow utilities, `window.confirm`, or focus-outline suppression. Navigation says Runs; legacy route/type identifiers remain intact.
- Each of the eleven routes has one h1 and no horizontal page overflow in the reviewed desktop/mobile views. All eleven also have document width equal to client width at 1024px. Wide tables scroll within panels.
- Desktop sidebar is 208px; content is bounded by the shell's 1280px maximum. Main rails stack at tablet widths. Model dialogs measure 560px on desktop and become bottom sheets on mobile.
- Token contrast calculations: ordinary text on supported surfaces is at least 5.17:1 in dark and 4.63:1 in light. Status text/background pairs are at least 4.56:1; primary button text is at least 7.15:1. Focus uses the shared visible accent outline.

## Screens and results

| Screen | What changed | 1440 dark/light | 390 dark/light | Preserved behavior / QA |
| --- | --- | --- | --- | --- |
| Dashboard | Flat six-cell overview, model/prompt tabs, relative profile, recent-run rail | Reviewed | Reviewed | URL/picker/rail sync, partial-data leader rules, pagination; mobile cost is 28px digits with a 16px symbol and full precision |
| Evaluation run | Progress/metrics, composite breakdown, single-select URL filters, expandable result panes | Reviewed | Reviewed | Polling, exports, stored prompts/pricing/versions, errors and security outcomes; three fixture rows end at y886.5 in a 900px viewport |
| Runs | Month-grouped table, status counts, search/filters, mobile cards | Reviewed | Reviewed | API-wide counts, current-page filter guidance, pagination and deep links; eight two-model fixture rows end at y837.5, with footer visible |
| New evaluation | Four fieldset steps, automatic debounced validation, live run-size rail | Reviewed | Reviewed | Real API preview enables Start after a complete 1×1×20×1 selection; no run was started during browser QA |
| Prompts | Searchable table/cards and live template-validation form | Reviewed | Reviewed | Full-history search/counts, exactly-once input placeholder validation, optional system prompt, create navigation; singular counts corrected |
| Prompt detail | Read-only version tabs/panes, latest-based version draft, separate details form | Reviewed | Reviewed | Immutable history, keyboard selection, Reset, metadata-only save and unsaved-draft guards |
| Datasets | Searchable table/mobile rows and shared first-case form | Reviewed | Reviewed | Required initial case, Standard/Security swapping, typed metadata, 20-field/500-case limits |
| Dataset detail | Wrapped case grid/cards, inline editors, inline delete/discard confirmations | Reviewed | Reviewed | Stable IDs, long encoded text, one editor, dirty-draft guards, exports and last-case protection |
| Dataset import | Automatic preview, mapping/rules, fingerprint-safe import plan | Reviewed | Reviewed | Current initial state and tablet/mobile order checked; selected-file states reviewed using P7's saved four-view evidence plus 29 current regression tests |
| Playground | Equal Prompt/Reply panels, unsaved notice, metrics/cost and retry guidance | Reviewed | Reviewed | Local fixture success/error replies, retained drafts, scoped shortcut and retry behavior; no provider call was made |
| Models | Models-first tables/mobile cards, provider table, shared model/provider sheets | Reviewed | Reviewed | All kinds, write-only keys, pricing modes, stale metadata, refresh/quotas and limits; dialog/inline-confirm focus and 44px actions checked |

The shared Active switch has a 44×44px mobile hit area around its unchanged 36×20px track and 16px knob. Run pricing, pagination, summary and prompt disclosures also measure 44px on mobile. Segmented controls retain the written component/screen specification's 40px height; this is the specific exception to the generic 44px checklist wording.

## Evidence and limitations

Browser checks used the local backend/Vite app and a disposable local build server for density and Playground fixtures. Fixtures are derived from existing tests and are never compiled into product code. The fixture server disables mutations and does not contact providers.

P7's original browser run tested the 28-row CSV preview, invalid-row blocking, valid-only readiness, mapping changes, pagination and dialog focus at both sizes/themes. During this final pass, the browser automation file chooser failed to attach a file (first a stale input node, then a chooser timeout). Its selected-file smoke check was therefore not rerun. Existing selected-file screenshots were reviewed in all four views, and the current import suite passes. A fresh manual file-upload smoke check remains optional verification for the user; no import feature or safeguard was bypassed.

Capture timing in the in-app browser can lag a resize/theme change by one frame. Final illustrative evidence was captured in a separate call after the corresponding action. Earlier intermediate `q1-*.png` captures should not be used as publication screenshots.

## Deliberate deviations and data limits

- Dashboard summary/history APIs do not supply provider model identifiers or exact per-model/per-prompt request-failure counts. Unsupported subtitles are omitted and unsupported failure counts show a reasoned dash; display names are not relabelled as provider IDs.
- Run composite breakdowns are calculated from loaded result rows and disclose partial coverage; no composite-summary endpoint exists.
- Runs search/dataset/model filters apply to loaded data, with visible scope guidance. Status counts remain API-wide.
- Optional prompt-version evaluation preselection was omitted as explicitly allowed.
- Import retains the existing 25-row pagination and labels the default CSV delimiter as comma. JSON positions have separate row-number guidance. Zero-write and blocked plans follow API `can_commit`.
- Playground's error helper exposes only a message, so no HTTP status/error code is invented. Cost is an estimate based on captured configured rates, since the reply API has no pricing snapshot.
- Model limits editing stays OpenRouter-only, preserving the supported workflow. Source/effective-date editing is omitted because request contracts do not support it. Missing required credentials may still be saved as a placeholder connection, with a warning that its models cannot run.
- The 40px segmented-control rule is followed over the generic touch-target wording, as noted above.

## Open questions

No implementation scope decision is waiting for an answer. Optional follow-ups are a fresh manual CSV/JSON chooser smoke check and future backend support for the unavailable summary/provider/error metadata above. Neither requires a backend change in this redesign.

## Documentation handoff

See [WIKI-PROPOSAL.md](WIKI-PROPOSAL.md) for proposed replacement/addition text using the existing wiki's actual page names, plus Home/Sidebar links for the two proposed new guides. No wiki page was edited or published. No push, PR, or merge was performed.
