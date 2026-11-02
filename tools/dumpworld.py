#!/usr/bin/env python3
"""Data místností z programu → `data/world.json` (úseky paměti originálu).

    ./tools/dumpworld.py

Bajty se berou z obrazu programu na vstupu do hry (`build/entry.z80`,
`tools/mksnapshot.sh`), ne ze hry: `tools/traceworld.py` ověřil, že stavba
místnosti čte jen bajty, které se od nahrání nezměnily. Které úseky to jsou,
říká `build/world/reads.json` (co statická stavba všech 245 místností přečte,
než to sama zapíše, a proud od entit po atribut). Každé přečtené místo musí
padnout do některého úseku `REGIONS` — jinak nástroj spadne, protože by
remaku chyběla data.

Formát popisuje `sources/docs/world.md`.
"""
import base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as B                                                # noqa: E402

READS = os.path.join(B.BUILD, 'world', 'reads.json')
OUT = os.path.join(B.ROOT, 'data', 'world.json')

# ★ (jméno, od, do včetně, popis) — sources/docs/world.md
REGIONS = [
    ('rooms', 0x61A8, 0x71A5,
     'proudy místností $00-$29 a záznamy $D6-$E8 (§2, §3)'),
    ('room99Code', 0x8435, 0x8435,
     'místnost $99 ukazuje do grafiky bloků; tenhle bajt kódu čte jako svůj (§6)'),
    ('blocks', 0x9A00, 0xB9FF,
     '32 bloků po 256 B: 32 řádků × 4 B kresby, maska +$80 (§4)'),
    ('arrows', 0xC620, 0xC71F,
     'šipky východů $61/$63/$65/$67 po 32 B kresby, maska je následující sprite (§5)'),
    ('recordD5', 0xC844, 0xC84A,
     'záznam místnosti $D5 uprostřed proměnných (§3)'),
    ('recordsCBE7', 0xCBE7, 0xCDE5, 'záznamy místností $5B-$9D (§3)'),
    ('recordsE5E7', 0xE5E7, 0xE9D9, 'záznamy místností $2A-$5A (§3)'),
    ('recordsEA9A', 0xEA9A, 0xEB87, 'záznamy místností $9F-$BA (§3)'),
    ('record9E', 0xEC2C, 0xEC33, 'záznam místnosti $9E (§3)'),
    ('roomTable', 0xEC54, 0xEE3D, '245 ukazatelů na proudy a záznamy místností (§1)'),
    ('room99Table', 0xEE50, 0xEE51, 'místnost $99: dva bajty za tabulkou (§6)'),
    ('recordsFA28', 0xFA28, 0xFAF4, 'záznamy místností $BB-$D4 (§3)'),
    ('recordsFD70', 0xFD70, 0xFDD1, 'záznamy místností $E9-$F4 (§3)'),
]
# ★ proměnné, které stavba čte dřív, než je zapíše: stav hry, ne data (§7)
VARIABLES = {0x6126, 0xC864, 0xFDEF, 0x619C, 0x619D}


def main():
    if not os.path.exists(READS):
        raise SystemExit('chybí build/world/reads.json – spusť ./tools/traceworld.py')
    mem = B.memory64(B.ENTRY_Z80)
    reads = set(json.load(open(READS))) - VARIABLES
    covered = set()
    regions = {}
    for name, start, end, _note in REGIONS:
        covered.update(range(start, end + 1))
        regions[name] = {
            'address': start,
            'length': end - start + 1,
            'bytes': base64.b64encode(bytes(mem[start:end + 1])).decode('ascii'),
        }
    missing = sorted(reads - covered)
    if missing:
        raise SystemExit('cteni mimo useky: ' + ' '.join('$%04X' % a for a in missing[:20]))
    # popis úseků: REGIONS výš a sources/docs/world.md; do dat poznámky nejdou
    data = {
        'rooms': 245,
        'regions': regions,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    total = sum(r['length'] for r in regions.values())
    print('%s: %d useku, %d B, pokryto %d prectenych adres'
          % (os.path.relpath(OUT, B.ROOT), len(regions), total, len(reads)))


if __name__ == '__main__':
    main()
