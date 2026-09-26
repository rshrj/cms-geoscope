# cms-geoscope

> **Not an official CMS tool.** This is an independent project. It is not developed, endorsed or
> maintained by the CMS Collaboration or CERN. It reads publicly available CMSSW geometry
> descriptions and has not been validated against CMS's own detector displays.

An interactive 3D viewer for the CMS Phase-2 detector (Run 4, scenario D127), built from
the CMSSW simulation geometry. It runs in the browser with three.js; there is no server
component.

Features: cutaway modes, per-subsystem visibility and isolation, click and hover to
inspect a part (material, position, shape, placement path, matching reco DetId),
fuzzy search, distance measurement, a Full / Balanced / Fast detail setting, and view
links that reproduce the camera, cut, visibility and measurements.

## Quick start

Requires Node 22 or newer.

```sh
npm install
npm run data      # geometry/*.root -> public/data  (needs the ROOT files, see below)
npm run dev       # http://localhost:5173
```

The generated data (about 280 MB) and the ROOT files are not in the repository. To
produce the ROOT files, run `npm run export-geometry`, which drives CMSSW in a VM
(see [Exporting the geometry](#exporting-the-geometry)). `npm run build` followed by
`npm run preview` serves the compiled app.

### Without the CMSSW VM

`npm run export-geometry` assumes the [cmssw-workspace](https://github.com/rshrj/cmssw-workspace)
VM. If you have CMSSW some other way (lxplus, CVMFS, a container), you only need two files
in `geometry/`. From any CMSSW release that includes the Fireworks geometry dumps, run:

```sh
cd $CMSSW_RELEASE_BASE/src/Fireworks/Geometry/python
cmsRun dumpSimGeometry_cfg.py  tag=Run4 version=D127 out=cmsSimGeom-Run4D127.root
cmsRun dumpRecoGeometry_cfg.py tag=Run4 version=D127 tgeo=False out=cmsRecoGeom-Run4D127.root
```

and copy the two ROOT files into `geometry/`. The simulation file (about 3 MB) is
required by `npm run convert`; the reco file (about 170 MB) is only used by
`npm run detids` for the DetId lookup. Without it, run `npm run convert` instead of
`npm run data`; the viewer then just shows no DetIds. Recent CMSSW
releases have not been checked beyond the pinned nightly in `cmssw/export-geometry.sh`.

## Controls

| Input                     | Action                                                          |
| ------------------------- | --------------------------------------------------------------- |
| Drag / right-drag / wheel | Orbit / pan / zoom                                              |
| Click                     | Select a part; double-click or `F` frames it                    |
| `Esc`                     | Leave measuring, then clear selection, then leave isolation     |
| `1`–`5`, `R`              | Camera views; `R` returns to the overview                       |
| `/`                       | Search volume names (also matches TBPX, TFPX, TEPX, TBPS, TB2S) |
| `M`, `C`                  | Toggle measuring; clear measurements                            |

The address bar always holds the current view, and **Share link** copies it.

## How it works

```
CMSSW (VM)  ->  geometry/*.root  ->  tools/convert.mjs  ->  public/data  ->  src/ (three.js)
                                      tools/detids.mjs
```

- `cmssw/` — `export-geometry.sh` runs the stock Fireworks dump configs in a clean SCRAM
  area inside the [cmssw-workspace](https://github.com/rshrj/cmssw-workspace) VM and copies
  the ROOT files to `geometry/`. `manifest.txt` there records the release, global tag and
  file hashes. Edit `RELEASE` when the pinned nightly rotates off CVMFS.
- `tools/convert.mjs` — reads the TGeo geometry with JSROOT, tessellates each volume once,
  and writes per-subsystem binaries. Volumes with at least 200 copies are GPU-instanced,
  rarer ones are merged into shared meshes. It also writes the full placement tree.
- `tools/detids.mjs` — extracts DetId centres from the reco geometry (HGCAL cells omitted).
- `tools/tree.mjs <volume> [depth] [children]` — prints a subtree with shapes and
  materials, for adjusting the subsystem rules in `convert.mjs`.
- `src/` — the viewer:

| File                                               | Role                                                      |
| -------------------------------------------------- | --------------------------------------------------------- |
| `main.ts`                                          | Renderer, camera, controls, wiring                        |
| `detector.ts`                                      | Loads the data, builds meshes, applies cuts and isolation |
| `looks.ts`                                         | Subsystem colours and materials, cut-cap shader           |
| `tree.ts`                                          | Placement tree (paths, subtrees, copy counts)             |
| `picker.ts`                                        | CPU ray picking                                           |
| `inspector.ts`, `ui.ts`                            | Info card and side panel                                  |
| `search.ts`, `measure.ts`, `share.ts`, `detids.ts` | Search, measuring, view links, DetId lookup               |

## Development

```sh
npm run check     # typecheck, lint, format check and tests
npm run format    # apply Prettier
```

Source lives in `src/`, tests in `tests/` (Vitest). TypeScript is pinned to 6.0
because `typescript-eslint` does not support 7.x yet.

## License

MIT, see [LICENSE](LICENSE).

## Known limits

- The DetId shown for a part is the nearest reco element by position, not an exact link.
- HGCAL cells are not in the DetId table.
- The viewer draws the simulation geometry only; the reco TGeo file is not used.
