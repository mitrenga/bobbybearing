#!/usr/bin/env python3
"""Smyčka menu originálu bez kláves: obrazovka po každé otočce a její T-stavy.

    ./tools/mksnapshot.sh && ./tools/tracemenu.py [--loops N]

★ Menu po nahrání (`$D6B6`) běží v DI; otočka smyčky `$D6D0` je práce
plus `LDIR` 2000 B z ROM do ROM (`$D6FF`), takže tempo je v T-stavech, ne
ve snímcích (`sources/docs/disasm_notes.md` §1). Bez kláves se v ní hýbe
jen **míč v „O"** (`$D90A`, každou druhou otočku: gravitace a odraz
v bufferu 4×64 B na `$DA30`, který `$D9B6` kopíruje na obrazovku) —
volič ovládání (`$D80A`) stojí.

Výstup `build/menu/`:

- `loops.bin.gz` — obrazovka (6912 B) po každé otočce: po návratu na
  `$D6D0`, otočka 1 až N; `loop0.bin` je obrazovka před první otočkou
  (hned za `CALL $D8F5`, `$D6CC`);
- `loops.json` — T-stavy každé otočky a stav míče před ní
  (`$D940` poloha, `$D93F` rychlost — `LD BC,($D93F)`: C rychlost, B poloha, `$D967` sprite, `$DA0C` sudá/lichá);
- `frame*.png` — pár snímků pro oko.

Převod v `app/screenComposer.js` (`menuLoop`) se proti tomu měří nástrojem
`tools/matchmenu.mjs`; data pro něj (sprajty, buffer, stav) dává
`tools/mkscreen.py`.
"""
import argparse, gzip, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as L                                                # noqa: E402

MENU = 0xD6D0           # ★ smyčka menu
FIRST = 0xD6CC          # ★ návrat z CALL $D8F5: obrazovka před první otočkou


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--loops', type=int, default=400)
    ap.add_argument('--out', default=os.path.join(L.BUILD, 'menu'))
    args = ap.parse_args()

    L.skoolkit_path()
    from skoolkit.snapshot import Snapshot
    from skoolkit.simulator import Simulator
    from skoolkit.simutils import from_snapshot, PC, T
    sys.path.insert(0, L.RETRO)
    from scr2png import scr_to_rgb, write_png

    sim = from_snapshot(Simulator, Snapshot.get(L.ENTRY_Z80), {}, None,
                        {'fast_djnz': False, 'fast_ldir': False})
    r, mem = sim.registers, sim.memory
    os.makedirs(args.out, exist_ok=True)

    while r[PC] != FIRST:
        sim.run()
    open(os.path.join(args.out, 'loop0.bin'), 'wb').write(bytes(mem[0x4000:0x5B00]))

    def state():
        return {'pos': mem[0xD940], 'vel': mem[0xD93F],
                'sprite': mem[0xD967] | (mem[0xD968] << 8), 'toggle': mem[0xDA0C]}

    screens = bytearray()
    loops = []
    while r[PC] != MENU:
        sim.run()
    for n in range(1, args.loops + 1):
        before = state()
        t0 = r[T]
        sim.run()                                   # z $D6D0 pryč
        while r[PC] != MENU:
            sim.run()
        loops.append({'loop': n, 'tstates': r[T] - t0, 'before': before})
        scr = bytes(mem[0x4000:0x5B00])
        screens += scr
        if n in (1, 2, 10, 50, 100):
            write_png(os.path.join(args.out, 'frame%05d.png' % n), scr_to_rgb(scr), 256, 2)
    with gzip.open(os.path.join(args.out, 'loops.bin.gz'), 'wb') as f:
        f.write(bytes(screens))
    json.dump({'loops': loops, 'count': args.loops, 'bytes': 6912},
              open(os.path.join(args.out, 'loops.json'), 'w'))
    ts = [x['tstates'] for x in loops]
    print('build/menu: %d otoček, T na otočku min %d / průměr %.0f / max %d (%.2f ms průměr)'
          % (args.loops, min(ts), sum(ts) / len(ts), max(ts), sum(ts) / len(ts) / 3500))


if __name__ == '__main__':
    main()
