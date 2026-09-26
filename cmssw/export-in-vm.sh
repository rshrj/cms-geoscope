#!/bin/bash
# Runs inside the cmssw Lima VM (sent over ssh by export-geometry.sh).
#
# Produces, from a pristine SCRAM area with no checked-out packages:
#   cmsSimGeom-Run4<GEOM>.root       full simulation geometry as TGeo (for the 3D viewer)
#   cmsRecoGeom-Run4<GEOM>.root      Fireworks reco geometry: DetId -> shape/position,
#                                     incl. HGCAL cells and MTD (for event overlays)
#   cmsTGeoRecoGeom-Run4<GEOM>.root  reco geometry as TGeo (see limitations below)
#   manifest.txt, *.log
#
# Known, expected messages (not failures):
#   - "MEN geometry not found" / empty ME0 volume: ME0 is not part of the geometry.
#   - TGeo reco only: FWTGeoRecoGeometryESProducer has no HGCAL or MTD support (its
#     Timing flag is ignored), and it emits TGeoArb8 "ComputeTwist" / "Bounding box not
#     valid" errors for ECAL barrel crystals and for the empty TIB/TEC/ME0/ECalEndcap/
#     HCalEndcap containers, which Phase-2 replaces with the OT and HGCAL.
set -euo pipefail

RELEASE=$1 ARCH=$2 GEOM=$3 PRODUCTS=$4
BASE=$HOME/work/geom-export
AREA=$BASE/$RELEASE
OUT=$BASE/out/Run4$GEOM

export TERM=dumb SCRAM_ARCH=$ARCH
set +u # the CMS environment scripts use unset variables
source /cvmfs/cms.cern.ch/cmsset_default.sh

if [ ! -d "$AREA" ]; then
  echo "==> Creating pristine SCRAM area $AREA"
  mkdir -p "$BASE"
  (cd "$BASE" && scram -a "$ARCH" project CMSSW "$RELEASE" >/dev/null)
fi
cd "$AREA/src"
if [ -n "$(find . -mindepth 2 -maxdepth 2 -type d -not -path './.git*' | head -1)" ]; then
  echo "ERROR: $AREA/src has checked-out packages; this area must stay pristine." >&2
  exit 1
fi
eval "$(scram runtime -sh)"
set -u
CFG=$CMSSW_RELEASE_BASE/src/Fireworks/Geometry/python

rm -rf "$OUT" && mkdir -p "$OUT/siteconf/JobConfig" && cd "$OUT"

# The default SITECONF (T2_CH_CERN) reaches Frontier only through CERN-internal
# proxies, which are unreachable from here. Connect to the Frontier servers
# directly instead; fine for a handful of geometry queries.
cat > siteconf/JobConfig/site-local-config.xml <<'EOF'
<site-local-config>
  <site name="LOCAL">
    <calib-data>
      <frontier-connect>
        <server url="http://cmsfrontier.cern.ch:8000/FrontierProd"/>
        <server url="http://cmsfrontier1.cern.ch:8000/FrontierProd"/>
        <server url="http://cmsfrontier2.cern.ch:8000/FrontierProd"/>
        <server url="http://cmsfrontier3.cern.ch:8000/FrontierProd"/>
        <server url="http://cmsfrontier4.cern.ch:8000/FrontierProd"/>
      </frontier-connect>
    </calib-data>
  </site>
</site-local-config>
EOF
export SITECONFIG_PATH=$OUT/siteconf

run() { # name cfg args...
  local name=$1 cfg=$2; shift 2
  echo "==> $name"
  if ! cmsRun "$CFG/$cfg" "$@" > "$name.log" 2>&1; then
    tail -30 "$name.log" >&2
    echo "ERROR: $name failed, see $OUT/$name.log" >&2
    exit 1
  fi
}

SUBDETS="tracker=True muon=True calo=True timing=True"
for p in ${PRODUCTS//,/ }; do
  case $p in
    sim)       run sim dumpSimGeometry_cfg.py tag=Run4 version=$GEOM out=cmsSimGeom-Run4$GEOM.root ;;
    reco)      run reco dumpRecoGeometry_cfg.py tag=Run4 version=$GEOM tgeo=False $SUBDETS out=cmsRecoGeom-Run4$GEOM.root ;;
    tgeo-reco) run tgeo-reco dumpRecoGeometry_cfg.py tag=Run4 version=$GEOM tgeo=True $SUBDETS out=cmsTGeoRecoGeom-Run4$GEOM.root ;;
    *) echo "ERROR: unknown product '$p' (sim, reco, tgeo-reco)" >&2; exit 1 ;;
  esac
done

{
  echo "date:       $(date -u +%FT%TZ)"
  echo "release:    $RELEASE"
  echo "arch:       $SCRAM_ARCH"
  echo "geometry:   Run4$GEOM"
  echo "globaltag:  $(grep -h -m1 'Global tag key' reco.log tgeo-reco.log 2>/dev/null | head -1 | sed 's/.*: //')"
  echo "files:"
  for f in *.root; do printf '  %-34s %10s  %s\n' "$f" "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -c1-16)"; done
  echo "log messages (error/exception lines):"
  for l in *.log; do printf '  %-14s %s\n' "$l" "$(grep -ciE 'exception|error' "$l" || true)"; done
} > manifest.txt
cat manifest.txt
