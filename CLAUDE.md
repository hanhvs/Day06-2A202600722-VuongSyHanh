# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This repo is a Day 06 AI product lab deliverable, not a long-lived app codebase. Three sibling directories, only one of which contains runnable code:

- `01-invidual-workshop/` — individual app-teardown writeup + evidence screenshots.
- `02-group-spec/` — group SPEC artifacts: `thin-spec.md` (the source of truth for what the prototype must do), `evidence-pack.md`, `synthesis-decide-toolkit.md`, plus `evidence/` screenshots.
- `prototype/` — the runnable Vietnam Airlines NEO AI Triage demo (Node + vanilla JS frontend). All code lives here.

When making product-behavior decisions, treat `02-group-spec/thin-spec.md` as authoritative — especially sections 4 (Core MVP intents), 7 (failure mode), 8 (must-have requirements), and 9 (acceptance criteria). The prototype code must keep matching these.

## Prototype: commands

All commands run from `prototype/`:

```bash
cd prototype
npm install
cp .env.example .env   # README uses "copy" (Windows); use cp on macOS/Linux
npm run dev            # = node server.js, serves on http://localhost:3000
```

No build step, no test runner, no linter configured. `npm start` and `npm run dev` are aliases — both just `node server.js`.

`.env` keys (server-only, never read by the frontend):

- `OPENAI_API_KEY` — if missing, server silently falls back to the deterministic mock.
- `OPENAI_MODEL` (default `gpt-4.1-mini`), `OPENAI_BASE_URL`, `PORT` (default 3000), `LLM_TIMEOUT_MS` (default 12000).
- `FORCE_MOCK_MODE=true` — force the fallback path even when a key is present. Useful for demos and for testing deterministic guardrails in isolation.

Health check: `GET /api/health` returns `{ ok, forceMockMode, hasApiKey, model }`.

## Prototype: architecture

Single Express server (`prototype/server.js`) serves the static frontend (`index.html`, `app.js`, `styles.css`) from its own directory and exposes:

- `POST /api/triage` — returns the final JSON in one shot. Used by curl/external testing and documented in `prototype/README.md`.
- `POST /api/triage/stream` — Server-Sent Events. Emits `{type:"stage", label}` messages as each pipeline step runs ("Đang phân loại…", "Đang hỏi AI…", "Đang kiểm tra rủi ro…"), then a terminal `{type:"done", result}` carrying the same JSON shape as the non-stream endpoint. The frontend uses this so the typing bubble shows live progress instead of just dots. Small `pause()` delays (180–260ms) between stages exist so mock-mode runs don't flash by too fast to read; remove them only if you're confident the LLM call alone provides enough perceived progress.
- `GET /api/flights` — proxy for Aviationstack `/v1/flights`. Forwards a Zod-validated subset of query params (`dep_iata`, `arr_iata`, `flight_iata`, `airline_iata`, `flight_status`, `flight_date`, `limit`, `offset`, etc.), injects `access_key` from `AVIATIONSTACK_API_KEY` env, and returns `{ pagination, flights: [...] }` where each flight is normalized to camelCase (`scheduledAt`, `delayMinutes`, `isOnGround`, etc.). Aviationstack docs use `data` in one example and `results` in code samples — the normalizer reads from either. Errors from upstream (401 `invalid_access_key`, 429 `rate_limit_reached`, etc.) are forwarded with the original status code, error code, and Vietnamese-prefixed message. The underlying helper is `callAviationstack(query)` which is also exposed as a tool to the LLM (below).

## LLM tool use

The LLM call (`callOpenAI`) is an **agentic loop**, not a single completion. It uses OpenAI's `tools` parameter with `tool_choice: "auto"` and loops up to `MAX_TOOL_ITERATIONS` (3) — each iteration the model can request tool calls, the server executes them, appends `role: "tool"` results to the message list, and re-prompts. The loop exits when the model returns a final assistant message with no tool_calls; that message's content is parsed as JSON (response_format is still `json_object`).

Tools live in the `TOOLS` registry at the top of the LLM section in `server.js`. Each entry has `{schema, execute, stageLabelForCall, stageLabelForResult}`:

- `schema` — the OpenAI function-tool JSON-Schema the model sees. Descriptions are load-bearing because they teach the model when NOT to call (e.g. "do NOT call for baggage rules, check-in, refund, etc."). If you add a new intent that should use a tool, update both the system prompt AND the tool description.
- `execute(args)` — server-side handler. Re-validates args with the same Zod schema as the public endpoint, then calls the underlying helper (`callAviationstack`). Returns either `{flights, pagination}` or `{error, code}` — never throws.
- `stageLabelForCall/Result` — used by the SSE pipeline. `callOpenAI` accepts an `onEvent` callback; the `/api/triage/stream` handler passes its `send` function so tool calls surface to the UI as live stages like "Đang tra Aviationstack — chuyến VN123".

Currently the only tool is `search_flights`. The `flight_status_query` intent is the one designed for it. Deterministic fallback (when the LLM is unavailable) detects flight codes via `FLIGHT_CODE_REGEX` (matches `VN|QH|VJ|BL|0V|HVN` + 1-4 digits) so the intent is still recognized in mock mode — but no tool call happens there, the fallback just asks the user for the flight code instead. If you want fallback to actually call the tool, you'll need to make `fallbackTriage`/`fillAndValidate` async.

The user payload sent to the LLM includes `currentDateVN` (today in UTC+7 ISO date format) so the model can resolve "hôm nay" without guessing — relevant for `flight_date` arguments.

The frontend is plain ES modules, no build, no framework. The SSE client is a hand-rolled `fetch` + `ReadableStream` parser in `app.js` (`streamTriage`) — not `EventSource`, because EventSource is GET-only and we POST a JSON body.

The non-obvious thing is the **two-layer response pipeline**. Every request (both endpoints) flows through:

1. **LLM call** (`callOpenAI`) — asks OpenAI to return JSON matching `TriageResponseSchema`. If `FORCE_MOCK_MODE`, no API key, timeout, or any error: falls through to step 3.
2. **Schema fill + merge** (`fillAndValidate`) — takes raw LLM output, deep-merges it onto a fresh fallback-mock result so any missing fields get safe defaults, then runs the merged object through `applyRiskGuardrails`.
3. **Deterministic guardrails** (`applyRiskGuardrails`) — re-runs `detectIssues` regex matching over the message, may override `selectedIntent`, force-promotes `riskLevel` to `High` whenever `paymentDeducted` or payment-trouble keywords are present, regenerates `missingInfo` / `nextQuestions` / `actionChecklist` / `customerAnswer` / `handoffSummary` from the chosen intent.

The fallback path (`fallbackTriage`) goes through the same guardrail step at the end, so LLM and mock responses end up shaped identically and both honor the High-risk rule. This is intentional: the spec requires that "tiền đã trừ" (money deducted) cases ALWAYS land at `riskLevel = High` and `shouldHandoff = true` regardless of what the LLM said. Don't move risk logic into the system prompt only — keep it deterministic in `applyRiskGuardrails`.

Schemas are defined with Zod at the top of `server.js`:

- `IntentEnum` — 12 intents. The Core MVP (deep handling) is exactly three: `ticket_payment_issue`, `baggage_addon_payment_issue`, `unclear_payment_issue`. Others (`baggage_policy_question`, `checkin_question`, `flight_document_question`, `general_vna_question`, `travel_place_recommendation`) get short canned answers; `seat_selection_issue`, `date_change_request`, `refund_request`, `other_addon_issue` are detection-only.
- `KnownInfoSchema` — the conversation slot bag. Tracked across turns by the client and sent back in `conversationState.knownInfo`. `paymentDeducted` is the load-bearing field for risk escalation and survives correction turns (e.g. "không phải vé, là hành lý") — this is what `mergeKnownInfoValues` exists to protect.
- `TriageResponseSchema` — the full response contract; the frontend (`app.js`) reads every field from this shape.

The frontend keeps `conversationState` in a module-level variable, sends it on every request, and merges the response's `knownInfo` back in (`updateState` in `app.js`). There is no persistence — refresh clears state. The "Correction" quick-test seeds state via `seedCorrectionDemoState` to prove the context-preservation acceptance criterion (#8 in the spec).

## Conventions

- User-facing strings in the prototype (UI copy, customerAnswer, checklist items, missing-info labels) are Vietnamese. Internal field names (intents, schema keys) are English. Keep that split — the system prompt explicitly forbids leaking field names like `bookingCode` or `selectedIntent` into `customerAnswer`.
- Don't claim live data the prototype can't verify: opening hours, prices, distances, booking confirmations, baggage updates. The safety notice and `caution` field on travel suggestions exist to enforce this.
- When adding a new intent: add it to `IntentEnum`, to `detectIssues` regex matching, to `missingInfoFor` / `nextQuestionsFor` / `checklistFor` / `customerAnswerFor`, to the system prompt's enum list in `buildSystemPrompt`, AND to `intentLabels` in `app.js`. Forgetting any of these silently degrades that path.
