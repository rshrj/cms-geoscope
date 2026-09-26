#!/bin/bash
# Regenerate the CMS geometry ROOT files in the cmssw VM and copy them to ../geometry/.
#
#   cmssw/export-geometry.sh                        D127, all products
#   cmssw/export-geometry.sh -g D110 -p sim         another scenario, sim only
#   cmssw/export-geometry.sh -r CMSSW_20_1_X_2026-09-25-2300
#
# Products (-p, comma separated): sim, reco, tgeo-reco. See export-in-vm.sh.
# Nothing outside ~/work/geom-export is touched in the VM.
set -euo pipefail

RELEASE=CMSSW_20_1_X_2026-09-13-2300 # pinned like cmssw-workspace's smoke test
ARCH=el9_aarch64_gcc14
GEOM=D127
PRODUCTS=sim,reco,tgeo-reco
while getopts r:a:g:p: o; do
  case $o in
    r) RELEASE=$OPTARG ;; a) ARCH=$OPTARG ;; g) GEOM=$OPTARG ;; p) PRODUCTS=$OPTARG ;;
    *) sed -n '2,9p' "$0"; exit 1 ;;
  esac
done

HERE=$(cd "$(dirname "$0")" && pwd)
DEST=$HERE/../geometry
VM=lima-${CMSSW_LIMA_INSTANCE:-cmssw}

ssh "$VM" bash -s -- "$RELEASE" "$ARCH" "$GEOM" "$PRODUCTS" < "$HERE/export-in-vm.sh"

mkdir -p "$DEST"
echo "==> Copying to $DEST"
ssh "$VM" "cd work/geom-export/out/Run4$GEOM && tar cf - *.root *.log manifest.txt" | tar xf - -C "$DEST"
ls -la "$DEST"
