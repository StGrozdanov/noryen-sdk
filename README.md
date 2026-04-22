# @noryen/sdk

TypeScript SDK for sending AI traces to Noryen so you can debug model behavior,
latency and cost in production.

## Install

```bash
npm install @noryen/sdk
```

## Quickstart

```ts
import { noryen } from "@noryen/sdk";

noryen.init({
  apiKey: process.env.NORYEN_API_KEY!,
  // optional: endpoint override
  // endpoint: "https://your-api.example.com/v1/track",
});

noryen.track({
  model: "gpt-4o-mini",
  provider: "openai",
  prompt: "Summarize this text in 3 bullets.",
  response: "1) ... 2) ... 3) ...",
  latency: 820,
  cost: 0.0012,
  metadata: { env: "prod", feature: "summary" },
});
```

## Long-running servers

Initialize once at startup and reuse across calls. Use `noryen.setContext` to stamp every trace with service-level metadata.

```ts
// lib/noryen.ts
import { noryen } from "@noryen/sdk";

noryen.init({ apiKey: process.env.NORYEN_API_KEY! });

noryen.setContext({
  service: "my-api",
  env: process.env.NODE_ENV,
});

export { noryen };
```

Then wrap your OpenAI client wherever you build it:

```ts
import OpenAI from "openai";
import { noryen } from "./lib/noryen";

const openai = noryen.wrapOpenAI(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  { metadata: { feature: "summarize" } },
);
```

On a long-lived process, batches flush automatically in the background. For **serverless** runtimes (Lambda, Vercel functions) see [Flushing the queue](https://noryen.com/docs/sdk/flush).

## OpenRouter (OpenAI-compatible client)

Use the official OpenAI SDK with OpenRouter's base URL, then wrap it the same way as OpenAI.

```ts
import OpenAI from "openai";
import { noryen } from "@noryen/sdk";

noryen.init({ apiKey: process.env.NORYEN_API_KEY! });

const client = noryen.wrapOpenAI(
  new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
  }),
);

await client.chat.completions.create({
  model: "google/gemini-3.0-flash",
  messages: [{ role: "user", content: "Hello" }],
});
```

## TrackContext (RAG / retrieval on a trace)

Attach structured context to a trace when you use `track()` yourself (for example OpenRouter via `fetch`, or any path that is not wrapped). This is separate from `noryen.setContext()`, which only sets default **metadata** keys.

```ts
noryen.track({
  model: "google/gemini-3.0-flash",
  provider: "openrouter",
  prompt: "Analyze the attached health summary.",
  response: "{ … }",
  latency: 1200,
  metadata: { feature: "personal_plan" },
  context: {
    instructions: "You are a clinical assistant…",
    documents: [
      {
        content: "User health summary text or placeholder for an attachment.",
        source: "app.health_data",
      },
    ],
    retrieval: {
      query: "user health data analysis",
      method: "manual",
      k: 1,
    },
  },
});
```

Provider wrappers populate trace context automatically from tool results, file search, and similar. See [TrackContext docs](https://noryen.com/docs/sdk/context) for the full shape and wrapper behavior.

## React Native / Expo

The SDK is plain TypeScript—no native modules. Use a **public** env key name (for example `EXPO_PUBLIC_NORYEN_API_KEY`) only if you accept that it ships in the app bundle; otherwise proxy LLM calls through your backend and keep the Noryen key server-side.

```ts
// lib/noryen.ts
import { noryen } from "@noryen/sdk";

let initialized = false;

export function ensureNoryenInitialized() {
  if (initialized) {
    return;
  }
  const apiKey = process.env.EXPO_PUBLIC_NORYEN_API_KEY;
  if (!apiKey) {
    initialized = true;
    return;
  }
  noryen.init({ apiKey, debug: __DEV__ });
  initialized = true;
}

ensureNoryenInitialized();
export { noryen };
```

Import `lib/noryen` once from your root layout so init runs at startup. Set global metadata (platform, app version) with `noryen.setContext({ … })` from a provider `useEffect`. Use `noryen.track({ … })` after your HTTP call to OpenRouter or another API, passing `metadata` and optional `context` as in the TrackContext example above.

## Endpoint Resolution

`@noryen/sdk` uses this priority order:

1. `init({ endpoint })`
2. Environment variables:
   - `NORYEN_API_URL`
   - `NORYEN_TRACK_ENDPOINT`
   - `NEXT_PUBLIC_NORYEN_API_URL`
3. Hosted default

This keeps zero-config onboarding while still allowing self-hosting/override.

## Provider Wrappers

`@noryen/sdk` includes wrappers to auto-track OpenAI, Anthropic, and Gemini calls.

```ts
import OpenAI from "openai";
import { noryen } from "@noryen/sdk";

noryen.init({ apiKey: process.env.NORYEN_API_KEY! });

const openai = noryen.wrapOpenAI(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
);

await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Write a haiku about testing." }],
});
```

## Local Development

```bash
npm ci
npm run check
npm run type-check
npm run build
```

## Open Source Contribution Flow

1. Fork the repo
2. Create a branch from `main`
3. Make focused changes
4. Run:
   - `npm run check`
   - `npm run type-check`
   - `npm run build`
5. Open PR with context and verification notes

See `CONTRIBUTING.md` for full guidelines.

## License

MIT, see `LICENSE`.
