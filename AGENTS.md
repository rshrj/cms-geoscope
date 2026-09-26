# AGENTS.md

Browser 3D viewer for the CMS Phase-2 (Run 4, D127) detector: three.js + Vite + TypeScript,
fed by a JSROOT converter. Unofficial project, MIT. User docs are in `README.md`; the feature
backlog is the GitHub issues (labels `physics`, `viewing`, `output`, `usability`, `geometries`).

## Commands

```sh
npm run check        # typecheck + eslint + prettier + vitest: run before every commit
npm run dev          # http://localhost:5173 (use 127.0.0.1 if Chrome blocks WebGL on localhost)
npm run build && npm run preview     # compiled app, port 4173
npm run data         # convert + detids: geometry/*.root -> public/data (needs the ROOT files)
npm run export-geometry              # CMSSW in the Lima VM -> geometry/*.root
```

`public/data/` (about 280 MB) and `geometry/*.root` are gitignored. Without `public/data` the
viewer cannot load, so for UI work check it exists (`ls public/data/manifest.json`) before
assuming a bug. `convert` needs an 8 GB heap (already in the script).

## Layout

| Path                                                                            | Role                                                                                                                                     |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/convert.mjs`                                                             | TGeo (JSROOT) to per-subsystem `.bin`, `manifest.json`, `tree.bin/json`. Subsystem rules, material classes and `MIN_INSTANCES` live here |
| `tools/detids.mjs`                                                              | reco geometry to `detids.bin` (DetId centres in metres, HGCAL cells omitted)                                                             |
| `tools/tree.mjs`                                                                | prints a volume subtree; for tuning the convert rules                                                                                    |
| `cmssw/`                                                                        | export scripts run against the CMSSW VM (`export-in-vm.sh` runs inside it)                                                               |
| `src/main.ts`                                                                   | assembles the app, render loop                                                                                                           |
| `src/stage.ts` `views.ts` `quality.ts`                                          | renderer + post-processing, camera flights, Full/Balanced/Fast                                                                           |
| `src/detector.ts`                                                               | loads data, builds meshes, cut and isolation logic (`refresh`, `select`)                                                                 |
| `src/looks.ts`                                                                  | colours, materials, cut-cap shader                                                                                                       |
| `src/picker.ts` `inspector.ts` `input.ts`                                       | CPU picking, info card, mouse/keyboard                                                                                                   |
| `src/search.ts` `measure.ts` `share.ts` `link.ts` `detids.ts` `tree.ts` `ui.ts` | search, measuring, URL state, DetId lookup, placement tree, side panel                                                                   |
| `tests/`                                                                        | Vitest; only pure logic is tested (no WebGL)                                                                                             |

## Things that are easy to get wrong

- **Units:** TGeo is cm; the scene and all UI are metres.
- **Two draw kinds** (`Drawable` in `detector.ts`): _instanced_ (volumes with at least 200 copies,
  `InstancedMesh`, per-instance cut masks) and _baked_ (rare volumes merged into shared meshes,
  per-vertex `partId`). "Item" means an instance or a baked part; each maps to a placement
  index into the `PlacementTree`. Draw-call count drives frame rate, so raising `MIN_INSTANCES`
  trades triangles for fewer draws (it was 8, giving about 4,200 draws; now about 800).
- **Nested solids:** HGCAL/ETL sit inside a solid mother volume, so "outermost only" rendering
  hides them. The converter flags `nested`/`occluder`/`cap` and the cutaway opens enclosing
  solids per instance. Mirrored placements are pre-mirrored so every transform is a proper rotation.
- **Do not reintroduce GPU picking.** A render-target ID pass crashes ANGLE/Metal (out of memory,
  context lost). Picking is CPU ray casting in `picker.ts`.
- **Post-processing:** N8AO renders the scene itself, so Fast mode swaps in a plain `RenderPass`
  or draws straight to the canvas. Its noise seed is pinned in `stage.ts` to stop flicker; keep that.
- **Data loading** goes through `src/data.ts` (`DataSource`): deployed builds hold `*.gz` plus
  `compressed.json` (made by `tools/compress.mjs` as the last `build` step); dev serves raw files.
  Never `fetch` data files directly. The loader tolerates servers that already decode `.gz`.
- **Depth range** is refitted every frame in `main.ts` (a fixed near/far z-fights).
- **View state** lives in the URL hash (`share.ts`, synced by `link.ts`). New user-visible state
  should be added there, with a test in `tests/share.test.ts`.
- **Search aliases** (TBPX, TFPX, TEPX, TBPS, TB2S) are a hand-made map in `search.ts`
  (`aliases`): the sim geometry has no such names. TFPX is `ITDisc1-8`, TEPX `ITDisc9-12`.
- **DetIds** shown on parts are the nearest reco centre by position, not an exact link.
- **TypeScript is pinned to 6.0** because `typescript-eslint` does not support 7 yet.

## Conventions

- Prettier (`.prettierrc.json`) and ESLint are enforced in CI; run `npm run format` to fix.
- Match the surrounding style: short comments that say why, no decorative separators.
- No middle-dot separators in UI text (commas instead); buttons are borderless and filled.
- Add tests for pure logic (parsing, scoring, maths). WebGL code is verified by running it.
- To check UI changes, build, preview, and look at it in a browser; type checks do not cover rendering.

## Git

- Commit only when asked. Commits are GPG-signed (`commit.gpgsign` is on) with author
  `Rishi Raj <me@rishiraj.ch>`. If signing fails with "Operation cancelled" the pinentry could
  not prompt; ask the user to prime the agent in a real terminal. Do not use `--no-gpg-sign`.
- The repository is public (`github.com/rshrj/cms-geoscope`): no personal paths, tokens or
  unpublished data in commits. The VM's ssh alias `lima-cmssw` is the only machine-specific name.
- Do not add generated data, ROOT files or `dist/` to git.
