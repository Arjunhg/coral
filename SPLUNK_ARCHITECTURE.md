# Splunk Architecture

This is the shared-sidecar architecture used for the Splunk integration.

```mermaid
flowchart LR
  U[User in Browser] --> N[Next.js App]

  subgraph App Runtime
    N --> DB[(Postgres via Drizzle)]
    N --> BB[Browserbase]
    N --> AI[Gemini + Featherless]
    N --> VOICE[Speechmatics]
  end

  subgraph Coral Layer
    N --> C[lib/coral/client.ts]
    C -->|"HTTP + X-Sidecar-Secret"| S[Coral Sidecar]
    S --> CLI[coral CLI subprocess]
    CLI --> G[(GitHub)]
    CLI --> SE[(Sentry)]
    CLI --> L[(Linear)]
    CLI --> SP[(Splunk REST API)]
  end

  N --> EX["/api/coral/expose/*"]
  CLI --> EX

  AI --> RC[Related Context enrichment]
  RC --> C
  N --> EXP[Coral Explorer + NL-to-SQL]
  EXP --> C
```

## Data flow

1. A test fails in Browserbase.
2. `app/api/test-cases/run/route.ts` queries Coral for GitHub, Sentry, Linear, and Splunk context.
3. Splunk log events flow through `splunk.search_results` in `coral-sources/splunk.yaml`.
4. The related context is stored on the failed test case and shown in the UI.
5. The same sidecar/catalog powers Coral Explorer and voice-driven data queries.

## AI and agent location

- Gemini handles NL-to-SQL generation and Playwright script generation.
- Featherless handles screenshot failure analysis.
- Coral is the read-only federated data layer those agent flows query.
