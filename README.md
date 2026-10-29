# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `data/db/schema.ts` starts intentionally empty
- `references/examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Research Nodes

The Research group has a real execution layer for web search, web-page reading,
document extraction, public YouTube captions, source summarization, fact
extraction/checking, source comparison, reliability ranking, and manual source
approval. These operations default to deterministic processing without AI.

To enable the optional **Dùng AI để phân tích sâu** switch or media-file
transcription, add an API key to `.env` and restart the app. API keys stay
server-side and are not stored in exported workflow JSON files.

The Content Development group also has a real execution layer. Idea generation,
audience profiling, angle creation, outlining, drafting, rewriting, expansion,
and tone transformation use the configured AI API. Scoring, shortening, content
review, duplicate detection, policy checks, and manual approval can run locally
without AI; selected checks also offer an optional AI mode.

## Video Content Analysis

The **Phân tích nội dung video** basic block runs a six-step workflow: adaptive
video indexing, timestamped transcription, storyboard generation, per-segment
vision analysis, low-confidence review, and hierarchical final synthesis. Frame
extraction and change detection run locally. FFmpeg creates small, speech-focused
audio chunks before transcription, so long source videos are not uploaded to the
transcription endpoint as one oversized file. AI calls are reserved for speech
recognition, storyboard understanding, and final reasoning.

The default balanced profile keeps periodic frames as a safety net while also
selecting visual changes. This supports films as well as low-motion tabletop and
game-board recordings. Runtime frames and storyboards are kept outside workflow
JSON, so exported workflows do not embed large image payloads.

Local video analysis requires `ffmpeg` and `ffprobe` on PATH. `Run_App.bat`
starts the ready-built application for the fastest daily launch. `npm run dev`
remains available for development and starts the web editor plus a loopback-only
Node media service at `127.0.0.1:4317`. That service owns FFmpeg and long-file audio
chunking because the web route runtime cannot spawn local processes. Add
`OPENAI_API_KEY` to `.env` for transcription and visual analysis. Speaker-aware
transcription uses `OPENAI_DIARIZE_MODEL`; other transcription uses
`OPENAI_TRANSCRIBE_MODEL`.

## Basic and Advanced Node Libraries

The node library opens in **Cơ bản** mode with 46 task-oriented blocks. A basic
block either runs several primitive nodes as an internal pipeline or lets the
user choose one operation from a related set. Its latest output remains visible
like any other node.

Switch to **Nâng cao** to use all 199 primitive nodes directly. Existing workflow
JSON files remain compatible. A basic block can also be expanded on the canvas;
the editor creates its primitive nodes and reconnects compatible incoming and
outgoing edges automatically.

## Useful Commands

- `Run_App.bat`: open the ready-built app (fast daily launch)
- `npm run start`: start the ready-built app and local media service together
- `npm run dev`: start the development editor and local media service together
- `npm run dev:web`: start only the web editor (video transcription unavailable)
- `npm run media`: start only the loopback media service
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
