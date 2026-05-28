# Scriptless.ai

Scriptless.ai is an AI-driven testing workspace that turns a connected GitHub repository into generated test cases, executable browser automation scripts, and pass/fail test reports.

Live project: https://scriptless-ai.vercel.app/

## What This Project Does

- Connects to your GitHub account and lets you select repositories.
- Scans important source files from your repo and generates structured test cases using AI.
- Runs each test case in a real cloud browser session (Browserbase + Playwright).
- Stores run logs, generated scripts, pass/fail status, and session replay URLs.
- Uses AI vision analysis on failed runs to explain what likely went wrong.
- Supports voice commands for hands-free filtering and test execution actions.

## How It Works

1. User signs in with Clerk and is provisioned in PostgreSQL (Neon) with starter credits.
2. User authorizes GitHub OAuth, and token is stored in an HTTP-only cookie.
3. User adds a repository to workspace and configures target domain/global instructions.
4. `POST /api/generate-test-cases`:
- Reads filtered repo files from GitHub.
- Sends file tree + code excerpts to Featherless model (gemma).
- Saves generated test cases into `test_cases`.
- Deducts generation credits.
5. `POST /api/test-cases/run`:
- Reuses cached Playwright script or regenerates it with Gemini.
- Executes script in Browserbase cloud session via Playwright CDP.
- Persists logs, status, session URL, and optional vision analysis.
- Deducts execution credits.
6. Workspace UI shows repository-level stats and detailed per-test output.

## Voice Feature Walkthrough

Voice mode uses Speechmatics real-time transcription and a local parser to map transcript text into commands.

How to use:

1. Open `/workspace`.
2. Click `Voice Commands` button and allow microphone access.
3. Speak one of the supported commands.
4. Watch `Voice: Listening/Processing` status badge and toast confirmation.

Supported command intents (natural language supported):

- Connect a repo:
`connect repo`, `add repository`, `link repo`, `add a repository`, `configure a repository`, `please add a repository`
- Run tests:
`run tests`, `rerun tests`, `run failed tests`, `run selected tests`, `run the selected test cases`, `run the test`
- Filter results:
`show failed tests`, `show passing tests`, `show all tests`, `clear filter`

You can also speak similar phrasing. The parser is designed to handle natural variations.

Voice implementation details:

- Temp Speechmatics key: `POST /api/speechmatics/token`
- Streaming + transcript parsing: `hooks/useVoiceCommands.ts`
- Command mapping: `lib/speechmatics/commandParser.ts`
- Spoken summary after run: browser `speechSynthesis`

## Solution Overview

Problem:
- Teams spend too much time writing and maintaining manual UI tests.
- Non-QA contributors struggle to convert product behavior into executable checks.
- Debugging failures is slow without consistent logs/replays/context.

Solution:
- Scriptless.ai creates a no/low-code test workflow driven by repository context and AI.
- It combines AI generation + cloud browser execution + failure analysis in one workspace.
- Credit-based usage controls cost and maps cleanly to paid tiers.

## Project Structure

```text
app/
  page.tsx                      # Landing page
  workspace/                    # Main testing workspace UI
  api/
    github/                     # OAuth + GitHub repo fetch
    users/                      # User provisioning
    user-repo/                  # Saved repo management + settings
    generate-test-cases/        # AI test case generation
    test-cases/                 # Read/update/run test cases
    speechmatics/token/         # Voice session token
    checkout/stripe/            # Stripe checkout session
    webhooks/stripe/            # Stripe webhook receiver

components/
  custom/                       # Workspace, repo, and execution UI
  voice/                        # Voice command controls and status
  ui/                           # Shared UI primitives

lib/
  featherless/                  # Test generation + vision analysis clients/prompts
  speechmatics/                 # Real-time voice + command parsing + readback
  stripe.ts                     # Stripe server client

db/
  schema.ts                     # Drizzle table definitions
  index.ts                      # DB connection

hooks/
  useVoiceCommands.ts           # Mic capture + real-time command pipeline

context/
  UserDetailContext.tsx         # User profile/credits state
```

## Technologies Used

- Frontend: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS
- Auth: Clerk
- Database: Neon Postgres + Drizzle ORM
- AI (test case generation): Featherless OpenAI-compatible API (`google/gemma-4-31B-it`)
- AI (script generation): Google Gemini (`gemini-3.1-flash-lite`)
- AI (failure understanding): Featherless vision models (`google/gemma-4-31B-it`)
- Browser execution: Browserbase + Playwright Core
- Voice commands: Speechmatics real-time API
- Payments: Stripe (checkout + webhook scaffold)
- Deployment: Vercel (live link above)

## Data Model (Core Tables)

- `users`: profile and credit balance
- `repositories`: connected repos + project-level settings
- `test_cases`: generated tests, script, status, logs, replay URL, vision notes

## Setup and Local Run

1. Install dependencies:

```bash
npm install
```

2. Create `.env` file:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000

DATABASE_URL=

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=http://localhost:3000/api/github/callback

FEATHERLESS_API_KEY=
# Optional
# FEATHERLESS_VISION_MODEL=
# FEATHERLESS_VISION_FALLBACK_MODELS=

GEMINI_API_KEY=

BROWSERBASE_PROJECT_ID=
BROWSERBASE_API_KEY=

SPEECHMATICS_API_KEY=
# Optional override:
# NEXT_PUBLIC_SPEECHMATICS_RT_URL=wss://eu2.rt.speechmatics.com/v2

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

3. Run development server:

```bash
npm run dev
```

4. Open:
- `http://localhost:3000`

## Business Plan and Monetization Strategy

Current monetization foundation in code:
- Credit wallet per user.
- Credit deduction for generation and execution actions.
- Stripe checkout and webhook endpoints available for subscription wiring.

Recommended go-to-market pricing model:

- Free tier:
Limited monthly credits, single repository, community support.
- Pro tier:
Higher credits, multi-repo projects, priority execution, saved run history.
- Team tier:
Shared workspace, role-based access, CI integrations, SLA support.

Monetization levers:

- Subscription plans (monthly/annual).
- Usage add-ons (extra credits).
- Premium AI run modes (deeper analysis, multi-browser matrix).
- Enterprise onboarding and managed test strategy services.

## Future Plans

1. CI/CD integration:
GitHub Actions trigger for auto-run on PR and commit.
2. Better observability:
Historical trends, flaky test detection, and run analytics dashboard.
3. Collaboration:
Team workspaces, comments, and approval workflows.
4. Stronger billing UX:
In-app plan management, metering breakdown, invoice history.
5. Voice evolution:
Natural-language chaining commands and multilingual support.
6. Smarter AI:
Automatic selector healing and repo-specific memory across runs.
7. Security and compliance:
Audit logs, SOC2-readiness controls, and enterprise policy presets.
