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

const openai = noryen.wrapOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

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
