# Contributing to @noryen/sdk

Thanks for your interest in contributing.

## Development Setup

1. Fork the repository and clone your fork.
2. Install dependencies:

   ```bash
   npm ci
   ```

3. Run validation locally before opening a PR:

   ```bash
   npm run check
   npm run type-check
   npm run build
   ```

## Branching

- Base branch: `main`
- Branch name format (recommended): `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`

## Commit Messages

Conventional-style commits are recommended for clean history, for example:

- `feat: add metadata helper`
- `fix: prevent track call before init`
- `docs: improve release instructions`

## Pull Requests

Please keep PRs focused and include:

- A short problem statement
- What changed and why
- Any behavior or API impact
- Tests/checks run locally

PRs should pass all CI checks before merge.

## Reporting Bugs / Requesting Features

Use GitHub issues with the provided templates:

- Bug report
- Feature request

## Code of Conduct

By participating in this project, you agree to follow the rules in
`CODE_OF_CONDUCT.md`.
