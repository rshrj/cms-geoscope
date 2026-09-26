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

## Exporting the geometry

The viewer reads ROOT files produced by CMSSW's Fireworks geometry dumps. They are not in
the repository, so you generate them once (about 1.5 minutes plus a first-time setup).

```sh
npm run export-geometry                          # D127, all three products
cmssw/export-geometry.sh -g D110 -p sim          # another scenario, sim file only
cmssw/export-geometry.sh -r CMSSW_20_1_X_2026-09-25-2300   # another release
```

**Requirements.** The script expects the [cmssw-workspace](https://github.com/rshrj/cmssw-workspace)
Lima VM to be running (`cmsvm shell` opens it), reachable over ssh as `lima-cmssw`. To use
a differently named instance, set `CMSSW_LIMA_INSTANCE`. It needs network access to CVMFS
inside the VM, and the `reco` products also read the conditions database.

**What it does.**

1. Builds a pristine SCRAM area for the release at `~/work/geom-export/<release>` in the VM.
   It refuses to run in an area that has checked-out packages, so results always come from
   the stock release. Nothing else in the VM is touched.
2. Runs the stock `dumpSimGeometry_cfg.py` and `dumpRecoGeometry_cfg.py` configs.
3. Copies the results into `geometry/`, together with logs and a `manifest.txt` that records
   the release, architecture, global tag, file sizes and hashes, and the number of
   error lines per log.

| Flag | Meaning                                               | Default                        |
| ---- | ----------------------------------------------------- | ------------------------------ |
| `-r` | CMSSW release                                         | `CMSSW_20_1_X_2026-09-13-2300` |
| `-a` | SCRAM architecture                                    | `el9_aarch64_gcc14`            |
| `-g` | geometry scenario                                     | `D127`                         |
| `-p` | products, comma separated: `sim`, `reco`, `tgeo-reco` | all three                      |

| Product     | File                                         | Used for                         |
| ----------- | -------------------------------------------- | -------------------------------- |
| `sim`       | `cmsSimGeom-Run4<GEOM>.root`                 | the 3D model (required)          |
| `reco`      | `cmsRecoGeom-Run4<GEOM>.root` (about 170 MB) | DetId lookup                     |
| `tgeo-reco` | `cmsTGeoRecoGeom-Run4<GEOM>.root`            | not used; it lacks HGCAL and MTD |

**Known messages.** "MEN geometry not found" is expected, because ME0 is not part of D127.
The `tgeo-reco` log contains a couple of hundred TGeoArb8 warnings about ECAL crystals and
empty containers; they are a known limitation of that producer, not a failed run.

**Release rotation.** The aarch64 releases are nightly builds that disappear from CVMFS after
about two weeks, so the pinned default will eventually stop working. Pick a current one with
`-r`, and update the default in `cmssw/export-geometry.sh`.

### Without the CMSSW VM

If you do not use the VM and have CMSSW some other way (lxplus, CVMFS, a container), you only need two files
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

## Deploying

The app is static, so any static host works. The generated data is large (about 300 MB), which
is why `npm run build` also gzips everything in `dist/data` (about 80 MB afterwards) and writes
`dist/data/compressed.json`, an index the viewer uses to fetch and unpack the files in the
browser. The step is safe to re-run, checks every file by decompressing it before removing the
original, and does nothing when there is no data. The dev server keeps serving the raw files.

```sh
npm run build          # type-check, bundle, compress the data
npm run verify-build   # re-check every compressed file against the index
npm run preview        # try the deployed form locally
npm run deploy         # build, verify, then upload dist/ with the Vercel CLI (first run asks you to log in)
```

The data is generated on your machine and is not in the repository, so deploys are made from
a local build rather than by CI. Any other static host works the same way: upload `dist/`.
Because the browser decompresses the files itself, the host does not need to compress them.

## Roadmap

Planned features are tracked as [issues](https://github.com/rshrj/cms-geoscope/issues),
grouped by label: `physics`, `viewing`, `output`, `usability` and `geometries`. Issues
labelled [`next-up`](https://github.com/rshrj/cms-geoscope/labels/next-up) are planned first,
because they need no new data. Small ones are labelled
[`good first issue`](https://github.com/rshrj/cms-geoscope/labels/good%20first%20issue).
Ideas and requests are welcome.

## License

MIT, see [LICENSE](LICENSE).

## Known limits

- The DetId shown for a part is the nearest reco element by position, not an exact link.
- HGCAL cells are not in the DetId table.
- The viewer draws the simulation geometry only; the reco TGeo file is not used.
