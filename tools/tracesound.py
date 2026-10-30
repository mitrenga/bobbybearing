#!/usr/bin/env python3
"""Zvuk originálu v simulátoru: každá hrana beeperu v T-stavech (M6).

    ./tools/tracesound.py [--out build/sound]

★ Bobby Bearing hraje jen v obsluze přerušení `$FB08` → `$FB8C`
(`disasm_notes.md` §4, `physics.md` §13): dva sloty požadavků `$F061`,
`$F062` (efekt 1–8 z tabulek, od 9 výška tónu do šablony `$FC85`) a až osm
kanálů po 10 B od `$F063` (hrají se tři). Nástroj vezme **skutečný kód**
z obrazu hry (`build/trace/idle/init.bin`) a pustí obsluhu v simulátoru
SkoolKit (bez sporné paměti, od `$FB08` po `RET`) nad připravenou pamětí:

- **každý požadavek** 1–255 v `$F061` a prázdné kanály, a pak další
  přerušení bez požadavků, dokud efekt dohrává (kanály na nule) — každé
  přerušení zvlášť: stav kanálů před, každý `OUT` na port `$FE` (T od první
  instrukce `$FB08`, bit 4), délka obsluhy, stav kanálů a `$FC88` po;
- **dva požadavky naráz** (`$F061` i `$F062`), **kanály obsazené** (tři,
  čtyři — čtvrtý kanál leží přes `$F081`, data honící koule — a všech osm,
  kdy se požadavek zahodí), a kanály se **zbytky z paměti hry** (init.bin).

Výstup `build/sound/paths.json`: `cases` — pro každý případ `name`,
`memory` (bajty `$F061`–`$F0B2` na začátku, hex), `interrupts`: seznam
{`outs`: [[T, bit], …], `length`, `after`: bajty `$F061`–`$F0B2` + `$FC88`}.
`tools/matchsound.mjs` pustí na tutéž paměť `app/beeperPlayer.js`.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as B                                                # noqa: E402
B.skoolkit_path()

from skoolkit.simulator import Simulator                         # noqa: E402
from skoolkit.trace import Tracer                                # noqa: E402
from skoolkit.simutils import PC, SP, T                          # noqa: E402

HANDLER = 0xFB08
SENTINEL = 0x0000        # návratová adresa, na kterou kód nikdy nejde
STACK = 0xFF40           # zásobník pro běh obsluhy (mimo sledovanou paměť)
LO, HI = 0xF061, 0xF0B3  # sloty a osm kanálů
MAX_INTERRUPTS = 400


class Logger(Tracer):
    def __init__(self, *args):
        super().__init__(*args)
        self.outs = []
        self.start = 0

    def write_port(self, registers, port, value, offset):
        if port % 2 == 0:
            self.outs.append([registers[T] - self.start, (value >> 4) & 1])
        super().write_port(registers, port, value, offset)


def make_sim(image):
    mem = list(image)
    sim = Simulator(mem, {'SP': STACK, 'PC': HANDLER}, {'iff': 0, 'im': 2, 'tstates': 0},
                    config={'fast_djnz': False, 'fast_ldir': False})
    tracer = Logger(sim, 0, 0, 0, [0] * 16, 0, 0)
    sim.set_tracer(tracer)
    return sim, tracer


def interrupt(sim, tracer):
    """Jedna obsluha od $FB08 po RET: outs, délka."""
    mem, r = sim.memory, sim.registers
    mem[STACK] = SENTINEL & 0xFF
    mem[STACK + 1] = SENTINEL >> 8
    r[SP] = STACK
    r[T] = 0
    tracer.outs = []
    tracer.start = 0
    import contextlib, io
    with contextlib.redirect_stdout(io.StringIO()):
        tracer.run(HANDLER, SENTINEL, 0, 0, False, None, None, None, None, '$', '04X', '04X')
    assert r[PC] == SENTINEL, 'obsluha neskončila na RET (PC $%04X)' % r[PC]
    return tracer.outs, r[T]


def snapshot(mem):
    return bytes(mem[LO:HI]).hex() + bytes([mem[0xFC88]]).hex()


def run_case(image, name, setup, requests=()):
    """`setup(mem)` připraví paměť; pak obsluhy, dokud kanály hrají."""
    sim, tracer = make_sim(image)
    mem = sim.memory
    for a in range(LO, HI):
        mem[a] = 0
    setup(mem)
    case = {'name': name, 'memory': bytes(mem[LO:HI]).hex(), 'interrupts': []}
    for n in range(MAX_INTERRUPTS):
        outs, length = interrupt(sim, tracer)
        case['interrupts'].append({'outs': outs, 'length': length, 'after': snapshot(mem)})
        playing = any(mem[0xF063 + 10 * k] for k in range(3)) or mem[0xF061] or mem[0xF062]
        if not playing:
            break
    return case


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=os.path.join(B.BUILD, 'sound'))
    args = ap.parse_args()
    image = open(os.path.join(B.BUILD, 'trace', 'idle', 'init.bin'), 'rb').read()
    cases = []

    def request(*values):
        def setup(mem):
            mem[0xF061], mem[0xF062] = (values + (0, 0))[:2]
        return setup

    for v in range(1, 256):
        cases.append(run_case(image, 'effect %d' % v, request(v)))
    for a, b in [(1, 2), (5, 6), (6, 6), (9, 200), (7, 8), (3, 100)]:
        cases.append(run_case(image, 'both %d+%d' % (a, b), request(a, b)))

    def busy(count, value):
        def setup(mem):
            for k in range(count):
                mem[0xF063 + 10 * k] = 4
                mem[0xF064 + 10 * k] = 2    # typ 2: ticho, jen odpočet
            mem[0xF061] = value
        return setup
    cases.append(run_case(image, 'three busy, request 6', busy(3, 6)))
    cases.append(run_case(image, 'four busy, request 1', busy(4, 1)))
    cases.append(run_case(image, 'seven busy, request 5', busy(7, 5)))
    cases.append(run_case(image, 'eight busy, request 5 (dropped)', busy(8, 5)))
    # ★ se zbytky z paměti hry: init.bin má v kanálech staré parametry
    def leftovers(value):
        def setup(mem):
            for a in range(LO, HI):
                mem[a] = image[a]
            mem[0xF061], mem[0xF062] = value, 0
        return setup
    for v in (1, 5, 6, 150):
        cases.append(run_case(image, 'leftovers, request %d' % v, leftovers(v)))

    os.makedirs(args.out, exist_ok=True)
    out = os.path.join(args.out, 'paths.json')
    json.dump({'cases': cases}, open(out, 'w'))
    interrupts = sum(len(c['interrupts']) for c in cases)
    outs = sum(len(i['outs']) for c in cases for i in c['interrupts'])
    print('%s: %d pripadu, %d obsluh, %d hran' % (os.path.relpath(out, B.ROOT), len(cases), interrupts, outs))


if __name__ == '__main__':
    main()
