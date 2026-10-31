#!/usr/bin/env python3
"""Záznam obrazovky po hře originálu (`$71BB`) pro `tools/matchaftergame.mjs`.

    ./tools/traceaftergame.py [--script NAME | --all] [--list]

Hra se spustí z obrazu na vstupu jako záznam `timeout` v `tracephysics.py`
(start `0`, čas záplatou na 1) a nechá se doběhnout: konec času `$7494`,
koncová obrazovka `$7D06`, čekání `$7D45` a `$71AF` → **`$71BB`**. Tam se
uloží `init.bin` (64 KB s ROM) — z ní převod začíná.

★ Obrazovka po hře je smyčka **`$720C`**: průchod `$74CC` s `$FDEA = $66`
(`$7638`: fyzika koule pod ovládáním `$8214`, zpoždění `$7648`, kreslení
`$7F81`), pak výběr podle buňky pod koulí `$FE2C` (`$722C`–`$72A1`)
a nakreslení voleb, `JP $720C`. Ovládání je po dobu výběru **CURSOR**
(`$71BB` → `$FEE7 = 2`, `$FCB0`: `5` vlevo, `6` dolů, `7` nahoru,
`8` vpravo). Buňka `$10` (konec pruhu se šipkou) skočí na `$7481` = start
hry.

Zaznamená se celá RAM `$4000`–`$FFFF` **při prvním příchodu na `$720C`**
(konec vstupu `$71BB`) a pak **po každém dalším** (konec průchodu
smyčkou); průchod, který skončí na `$7481`, je poslední (`outcome`
`start`). Vstupy průchodu jsou čtení portů `[port, hodnota]` v pořadí jako
v `tracephysics.py`; klávesy drží skript **po průchodech**.

Výstup do `build/aftergame/<skript>/`: `init.bin`, `passes.xor.gz` (RAM
po vstupu a po každém průchodu, XOR s předchozí, gzip), `inputs.json`
(`inputs` — vstupu prázdné —, `outcomes`).
"""
import argparse, contextlib, gzip, io, json, os, random, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as B                                                # noqa: E402
B.skoolkit_path()
sys.path.insert(0, B.RETRO)

from playtrace import KEYS, ROWS                                 # noqa: E402
from tracephysics import Logger, GAME, UP                        # noqa: E402
from skoolkit.snapshot import Snapshot                           # noqa: E402
from skoolkit.simulator import Simulator                         # noqa: E402
from skoolkit.simutils import from_snapshot, PC                  # noqa: E402
try:
    from skoolkit.csimulator import CSimulator
except ImportError:                                              # pragma: no cover
    CSimulator = None

AFTER_GAME = 0x71BB     # ★ obrazovka po hře (z $71AF po konci hry)
LOOP = 0x720C           # ★ smyčka výběru: začátek průchodu
START = 0x7481          # ★ buňka $10 pod koulí: start hry
TO_AFTER_T = 69888*2000  # konec času + koncová obrazovka + čekání ≈ 7 s
PASS_T = 69888*20       # průchod výběru je pod 3 snímky
OUT = os.path.join(B.BUILD, 'aftergame')

# ★ záznam `timeout` (tracephysics.py): čas na 1, první tik ho dorazí
TIMEOUT = (GAME + [(330, 400, UP)], {0xFE66: 1, 0xFE67: 1, 0xFE68: 1, 0xFE69: 1})

# ★ CURSOR ($FCB0): 5 vlevo, 6 dolů, 7 nahoru, 8 vpravo
C_LEFT, C_DOWN, C_UP, C_RIGHT = '5', '6', '7', '8'
CKEYS = [C_LEFT, C_DOWN, C_UP, C_RIGHT, C_UP + C_LEFT, C_UP + C_RIGHT,
         C_DOWN + C_LEFT, C_DOWN + C_RIGHT, None]


def fuzz(seed, passes):
    """Klávesy po průchodech náhodou ze semínka: směr (i úhlopříčka) nebo
    nic, 2–30 průchodů."""
    rnd = random.Random(seed)
    out, n = [], 0
    while n < passes:
        length = rnd.randint(2, 30)
        key = rnd.choice(CKEYS)
        if key:
            for k in key:
                out.append((n, n + length, k))
        n += length
    return out


def hold(*parts):
    """Klávesy po průchodech z úseků (průchodů, klávesy)."""
    out, n = [], 0
    for length, keys in parts:
        for k in keys:
            out.append((n, n + length, k))
        n += length
    return out


# jméno -> (průchodů nejvýš, klávesy po průchodech)
SCRIPTS = {
    'idle': (150, []),
    'left': (200, hold((40, C_LEFT), (40, ''), (40, C_RIGHT), (40, ''), (40, C_UP))),
    'down': (200, hold((30, C_RIGHT), (60, C_DOWN), (60, C_UP), (50, C_LEFT))),
}
for _seed in range(1, 9):
    SCRIPTS['fuzz%d' % _seed] = (400, fuzz(_seed, 400))


def record(name, passes, keys):
    snap = Snapshot.get(B.ENTRY_Z80)
    cls = CSimulator or Simulator
    sim = from_snapshot(cls, snap, {}, {'ay': [None] * 16},
                        {'fast_djnz': False, 'fast_ldir': False}, None)
    script, patch = TIMEOUT
    tracer = Logger(sim, snap.border, snap.out7ffd, snap.outfffd,
                    list(snap.ay), snap.outfe, True, script=script, passes=None)
    sim.set_tracer(tracer)
    r, mem = sim.registers, sim.memory

    def draw(scr, frame, border, keyboard):
        for i in range(8):
            keyboard[i] = 0
        if tracer.passes is None:
            for a, b, key in script:
                if a <= frame < b:
                    row, bit = KEYS[key]
                    keyboard[ROWS[row]] |= 1 << bit
        return True

    def to(pc, stop, max_tstates=0):
        with contextlib.redirect_stdout(io.StringIO()):
            tracer.run(pc, stop, 0, max_tstates, True, draw, None, None, None, '$', '04X', '04X')
        return r[PC]

    # hra do prvního průchodu, záplata času, pak až na obrazovku po hře
    pc = to(snap.pc, 0x751E)
    for address, value in patch.items():
        mem[address] = value
    pc = to(pc, AFTER_GAME, TO_AFTER_T)
    if pc != AFTER_GAME:
        raise SystemExit('%s: na $71BB nedošlo (PC $%04X)' % (name, pc))
    out = os.path.join(OUT, name)
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, 'init.bin'), 'wb').write(bytes(mem[0:0x10000]))

    # od teď klávesy po průchodech; vstup $71BB jako průchod −1 bez kláves
    tracer.script, tracer.passes, tracer.pass_no = [], [], -1
    tracer.log = []
    pc = to(pc, LOOP, PASS_T)
    if pc != LOOP:
        raise SystemExit('%s: vstup nedošel na $720C (PC $%04X)' % (name, pc))
    prev = bytes(mem[0x4000:0x10000])
    chunks = [bytes(a ^ b for a, b in zip(prev, bytes(0xC000)))]
    inputs, outcomes = [tracer.log], ['entry']
    tracer.passes = keys
    for n in range(passes):
        tracer.log = []
        tracer.pass_no = n
        # ★ průchod končí na dalším $720C; když na něj v PASS_T nedojde,
        # od uloženého stavu znovu na start hry $7481
        saved = (bytes(mem[0:0x10000]), list(r), list(tracer.log))
        pc_before = pc
        pc = to(pc, LOOP, PASS_T)
        if pc != LOOP:
            mem[0:0x10000] = saved[0]
            for i, v in enumerate(saved[1]):
                r[i] = v
            tracer.log = saved[2]
            pc = to(pc_before, START, PASS_T)
        if pc not in (LOOP, START):
            raise SystemExit('%s: průchod %d skončil na $%04X' % (name, n + 1, pc))
        cur = bytes(mem[0x4000:0x10000])
        chunks.append(bytes(a ^ b for a, b in zip(cur, prev)))
        prev = cur
        inputs.append(tracer.log)
        outcomes.append('start' if pc == START else 'pass')
        if pc == START:
            break
    with gzip.open(os.path.join(out, 'passes.xor.gz'), 'wb') as f:
        for c in chunks:
            f.write(c)
    json.dump({'passes': [list(s) for s in keys], 'outcomes': outcomes, 'inputs': inputs},
              open(os.path.join(out, 'inputs.json'), 'w'))
    cells = sorted({prev[0xFE2C - 0x4000]})
    print('%s: %d pruchodu%s, posledni bunka $%02X -> %s' % (
        name, len(inputs) - 1, ' (start hry)' if outcomes[-1] == 'start' else '',
        cells[0], os.path.relpath(out, B.ROOT)))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--script', default='idle')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--list', action='store_true')
    args = ap.parse_args()
    if args.list:
        for k, (n, keys) in SCRIPTS.items():
            print('%-8s %4d pruchodu' % (k, n))
        return
    for name in (list(SCRIPTS) if args.all else [args.script]):
        record(name, *SCRIPTS[name])


if __name__ == '__main__':
    main()
