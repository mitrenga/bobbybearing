#!/bin/sh
# Z kazety udělá snapshot a obraz RAM ve chvíli, kdy zavaděč Alkatraz předá
# řízení hře ($D6B6, tools/bblib.py ENTRY, sources/docs/tape_layout.md).
# Potřebuje sources/tape/Bobby Bearing.tzx (mimo git, sources/tape/README.md)
# a SkoolKit ve svision (R-008).
#
# tap2sna.py nahrává pulz po pulzu: provede BASIC, zavaděč Alkatraz
# (akcelerátor `alkatraz`), dešifrování i stub v bufferu tiskárny. Výsledek
# porovná se snapshotem ze hry tools/matchimage.py.
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SK=$(cd "$ROOT/tools" && python3 -c 'import bblib; print(bblib.SKOOLKIT)')
TAPE="$ROOT/sources/tape/Bobby Bearing.tzx"
mkdir -p "$ROOT/build"
[ -f "$TAPE" ] || { echo "chybi $TAPE - viz sources/tape/README.md"; exit 1; }
PYTHONPATH="$SK" python3 "$SK/skoolkit-10.1.data/scripts/tap2sna.py" \
    -c finish-tape=1 --start 0xD6B6 "$TAPE" "$ROOT/build/entry.z80" \
    | grep -v '^\[' || true
# na USR do zavaděče ($5D4C): ROM nahrála hlavičku a BASIC, turbo bloky ještě
# ne. Odtud skládá obraz paměti bez pulzů bblib.memory_image()
PYTHONPATH="$SK" python3 "$SK/skoolkit-10.1.data/scripts/tap2sna.py" \
    --start 0x5D4C "$TAPE" "$ROOT/build/atusr.z80" | grep -v '^\[' || true
# a totéž na konci pásky (PC uvnitř zavaděče, ještě před dešifrováním)
PYTHONPATH="$SK" python3 "$SK/skoolkit-10.1.data/scripts/tap2sna.py" \
    "$TAPE" "$ROOT/build/endtape.z80" | grep -v '^\[' || true
PYTHONPATH="$SK" python3 - "$ROOT" <<'PY'
import sys
from skoolkit.snapshot import Snapshot
root = sys.argv[1]
for name in ('entry', 'atusr', 'endtape'):
    snap = Snapshot.get(root + '/build/%s.z80' % name)
    ram = bytes(snap.ram(-1))
    open(root + '/build/%s.bin' % name, 'wb').write(ram)
    print('build/%s.bin: RAM $4000-$FFFF, %d B, PC $%04X' % (name, len(ram), snap.pc))
PY
