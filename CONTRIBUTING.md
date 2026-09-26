# Contributing

Thanks for your interest. Bug reports, ideas and pull requests are all welcome.

## Getting set up

```sh
npm install
npm run data     # needs geometry/*.root, see "Exporting the geometry" in the README
npm run dev
```

The viewer cannot load without `public/data`. If you cannot produce the ROOT files, open an
issue and describe what you want to work on; many changes (search, UI, tests, tooling) do not
need the geometry to be reviewed.

## Before opening a pull request

```sh
npm run check    # type-check, lint, format check and tests
```

- Keep changes focused, and add tests for pure logic (parsing, scoring, maths, data handling).
  Rendering code is checked by running it: please say in the pull request what you tried.
- Match the surrounding style. Prettier and ESLint run in CI; `npm run format` fixes formatting.
- New user-visible view state belongs in the URL hash (`src/share.ts`), with a test.
- Data files are always loaded through `src/data.ts`.
- `AGENTS.md` describes the layout and the non-obvious pitfalls; it is written for coding
  agents but is a good read for people too.

## Ideas and bugs

Planned features are tracked as [issues](https://github.com/rshrj/cms-geoscope/issues). Please
search before opening a new one. For a bug, include the browser, your GPU or machine, and a
share link (the address bar) that reproduces it.

## Deploying

Only the maintainer deploys the live site (see "Deploying" in the README).
