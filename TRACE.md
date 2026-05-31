# Agent Trace

Agent Trace records Coral queries executed by test runs and smart runs. It helps you understand which external signals were used, how long each query took, and how many rows were returned.

## What It Tracks

Each trace entry captures:

- `run_id`: groups queries from a single run
- `source`: logical source name (e.g., `github.commits`, `linear.issues`)
- `sql`: the SQL that was executed (truncated to 4000 chars)
- `rows_returned`: number of rows returned
- `duration_ms`: query duration
- `agent_role`: caller context (`failure_enricher`, `smart_run`, `explorer`)
- `status`: `ok`, `error`, or `timeout`
- `error_message`: last error if any

## Where It Lives

Trace data is stored in the database table `agent_queries` and is fetched by:

- `GET /api/test-cases/:id/trace`

The UI shows this under the **Agent Trace** tab in the test run modal.

## How It Works

1. **Queries run through `tracedSql`**
   - Any code path that wants tracing uses `tracedSql` from `lib/coral/traced-client`.

2. **`tracedSql` wraps Coral calls**
   - Executes Coral SQL
   - Measures duration
   - Normalizes status (`ok`, `error`, `timeout`)

3. **Query metadata is persisted**
   - `logAgentQuery` writes a row into `agent_queries`

4. **Trace endpoint groups by run**
   - `GET /api/test-cases/:id/trace` groups entries by `run_id` and returns summarized runs + queries

## Why It Is Helpful

- **Debugging**: See whether Coral calls are failing or timing out
- **Explainability**: Understand which external signals influenced a result
- **Performance**: Identify slow sources or expensive queries
- **Auditability**: Keep a historical record of decision inputs

## How To Test

1. Run a failing test case that triggers Coral enrichment.
2. Open the test details modal and switch to **Agent Trace**.
3. You should see a list of queries grouped by run.
4. Click a query to view the SQL and metadata.

You can also call the API directly:

```
GET /api/test-cases/:id/trace
```

### Expected Response Shape

```
{
  "runs": [
    {
      "runId": "b00lxgnl...",
      "startedAt": "2026-05-31T12:56:29.000Z",
      "queryCount": 3,
      "totalRows": 11,
      "totalMs": 4060,
      "queries": [
        {
          "source": "github.commits",
          "rowsReturned": 10,
          "durationMs": 1361,
          "status": "ok"
        }
      ]
    }
  ]
}
```

## Troubleshooting

- **403 Forbidden**: the test case does not belong to the signed-in user. Refresh the list after filtering or ensure the test case was created under the current user.
- **No rows**: the test run did not execute Coral queries (e.g., Coral not configured or no failure context). Verify `CORAL_SIDECAR_URL` and `CORAL_SIDECAR_SECRET`.
- **Timeouts**: increase Coral timeout or reduce query scope.

## Related Files

- `lib/coral/traced-client.ts`
- `lib/coral/trace-logger.ts`
- `app/api/test-cases/[id]/trace/route.ts`
