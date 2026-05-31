# Smart Run

Smart Run prioritizes test cases based on recent GitHub activity plus recent failures. It is designed to surface tests that are most likely impacted by recent changes, while still returning a useful list even when Coral cannot produce file-level signals.

## Inputs

Smart Run is invoked from the UI and calls `POST /api/test-cases/smart-run` with:

- `repoId`
- `repoOwner`
- `repoName`
- `withinDays` (default: 7)

## Data Sources

- Coral GitHub commits table: `github.commits`
- Local test case metadata: `test_cases.target_files`, `test_cases.status`, `test_cases.created_at`

## How It Works

1. **Fetch recent commits via Coral**
   - Runs a commit query scoped to `owner` + `repo`.
   - Filters commits by `commit__author__date` / `commit__committer__date` within the last `withinDays`.

2. **Extract file signals**
   - Attempts to extract file paths from:
     - `files` (if present)
     - `commit__message` (regex scan for file-like paths)

3. **Fallback: path probes when files are missing**
   - The GitHub list-commits API does not include per-commit file lists by default, so `files` is often `null`.
   - If no file signals were found, Smart Run probes recent commits using the `path` filter:
     - For up to 25 unique `target_files` across test cases, it runs a small query:
       `github.commits WHERE path = <file> AND date >= <since>`
     - Any hit counts that file as a recent change signal.

4. **Score test cases**
   - For each test case, compare `target_files` to the recent file signals.
   - Scoring logic:
     - +10 base if any overlap, plus +1 per overlapping file
     - +5 if the test was recently failed

5. **Prioritize**
   - Return up to 15 tests with score > 0.
   - If no scores are positive:
     - Return recently failed tests
     - If still empty, return the most recent tests (by `created_at` / `id`)

## Output

The API returns:

- `tests`: prioritized list with `id`, `title`, `score`, and a short `reason`
- `rationale`: explanation of whether Coral provided file signals
- `coral_used`: boolean flag indicating Coral data was queried

## Known Limitations

- `github.commits` may not include file lists, so path probing is used.
- If test cases have empty or missing `target_files`, Smart Run cannot match file signals.
- Path probing is limited to 25 distinct files to control query load.

## Configuration Notes

- Coral must be configured with a GitHub source.
- `CORAL_SIDECAR_URL` and `CORAL_SIDECAR_SECRET` must be set in the app environment.

## Troubleshooting

- If Smart Run shows "no recent commit signals":
  - Confirm Coral is reachable.
  - Verify `github.commits` returns rows for the repo.
  - Ensure test cases have `target_files` populated.

- If results always fall back to failed tests:
  - Check for file overlaps between `target_files` and recent commit paths.
  - Consider adding or fixing target file mappings in test cases.
