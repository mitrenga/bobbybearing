#!/usr/bin/env python3
"""Celá partie originálu z nahrávky RZX pro `tools/matchrules.mjs` (M5).

    ./tools/tracerules.py [--rzx sources/tape/bobbybearing.rzx] [--name rzx1]

Nahrávka `sources/tape/bobbybearing.rzx` (RZX Archive, xmikex a Jamie Angus,
SPIN 0.5; `sources/docs/provenance.md`) je **celá partie odehraná člověkem**:
snapshot 128K v menu po nahrání a 135 880 snímků vstupů — Bobby najde všech
pět bratrů a dotlačí ho domů. Přehrává ji SkoolKit (`CSimulator.exec_frame`
jako `rzxplay.py`): každý snímek proběhne přesně tolik instrukcí, kolik
zaznamenal emulátor, a čtení portů vrací zaznamenané hodnoty — originál
běží přesně tak, jak běžel hráči (`tools/playrzx.py` totéž po snímcích).

Na rozdíl od `tracephysics.py` se **kód nesmí měnit**: RZX počítá snímky
instrukcemi. Vstupy se chytají **pozorováním**: SkoolKit volá funkci na
každou instrukci a ta se dívá na `PC`:

- `$74F3` – start hry z menu (`$D969` → `$74CC`): paměť jako `start.bin`
  (remake z ní začne novou hru, `BobbyLogic.newGame`)
- `$751E` – začátek průchodu hlavní smyčkou: RAM `$4000`–`$FFFF` a čtení
  portů předchozího průchodu (`[port, hodnota]`, jak je `IN` dostal — zapisuje
  je `read_port` traceru)
- `$7D45` – konec hry: koncová obrazovka je nakreslená (`$7D06`), před
  čekáním; uloží se jako poslední průchod s výsledkem `gameover`

Výstup do `build/rules/<name>/` ve tvaru `tracephysics.py`: `start.bin`,
`init.bin`, `passes.NNN.xor.gz` (po 2000 průchodech), `inputs.json` (`inputs`, `outcomes`, `frames`:
snímek RZX na konci průchodu, `start: true`) — `matchrules.mjs` je přehraje
proti převodu průchod po průchodu, celou RAM. Když nahrávka obsahuje víc
partií, každá má svůj adresář (`<name>-2` …).
"""
import argparse, gzip, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as B                                                # noqa: E402
B.skoolkit_path()

from tracephysics import PASS, START, END                        # noqa: E402
from skoolkit import CSimulator                                  # noqa: E402
from skoolkit.rzxplay import parse_rzx, RZXTracer, RZXContext    # noqa: E402
from skoolkit.simulator import Simulator                         # noqa: E402
from skoolkit.simutils import from_snapshot, PC, T, IFF          # noqa: E402

RZX = os.path.join(B.ROOT, 'sources', 'tape', 'bobbybearing.rzx')


def ram64(memory):
    """64 KB jako 48K hra: ROM 1 a banky 5, 2, 0 (stub zavaděče zamkl $7FFD = $30)."""
    if len(memory) == 0x20000:
        m = memory.memory       # [ROM, banka 5, banka 2, banka na $C000]
        return b''.join(bytes(x) for x in m[0:4])
    return bytes(memory[0:0x10000])


class Logger(RZXTracer):
    """RZXTracer, který si zapisuje každé čtení portu."""

    def __init__(self, *args):
        super().__init__(*args)
        self.log = []

    def read_port(self, registers, port):
        value = super().read_port(registers, port)
        self.log.append([port, value])
        return value


class Game:
    """Jedna partie z nahrávky: zapisuje se průběžně, průchod po průchodu."""

    def __init__(self, out, rzx, start):
        self.out, self.rzx, self.start = out, rzx, start
        self.inputs, self.frames, self.outcomes = [], [], []
        self.file = None
        self.previous = None

    SEGMENT = 2000      # průchodů na soubor passes.NNN.xor.gz (≈ 96 MB rozbalených)

    def begin(self, memory, frame):
        os.makedirs(self.out, exist_ok=True)
        open(os.path.join(self.out, 'start.bin'), 'wb').write(self.start)
        open(os.path.join(self.out, 'init.bin'), 'wb').write(ram64(memory))
        self.first_frame = frame
        # ★ jako tracephysics.py: první řádek je XOR proti init.bin
        self.previous = ram64(memory)[0x4000:]
        self.segment = 0
        self.file = self.open_segment()

    def open_segment(self):
        # ★ po částech: 61 725 průchodů × 48 KB by se do paměti nástroje
        # nevešlo najednou (matchphysics.mjs čte segmenty po jednom)
        name = 'passes.%03d.xor.gz' % self.segment
        self.segment += 1
        return gzip.open(os.path.join(self.out, name), 'wb', compresslevel=6)

    def add(self, memory, inputs, frame, outcome):
        row = ram64(memory)[0x4000:]
        if self.previous is None:
            self.file.write(row)
        else:
            x = int.from_bytes(row, 'big') ^ int.from_bytes(self.previous, 'big')
            self.file.write(x.to_bytes(len(row), 'big'))
        self.previous = row
        self.inputs.append(inputs)
        self.frames.append(frame)
        self.outcomes.append(outcome)
        if len(self.inputs) % self.SEGMENT == 0:
            self.file.close()
            self.file = self.open_segment()

    def close(self):
        self.file.close()
        with open(os.path.join(self.out, 'inputs.json'), 'w') as f:
            json.dump({'rzx': self.rzx, 'start': True, 'patch': None, 'prefix': None,
                       'firstFrame': self.first_frame, 'frames': self.frames,
                       'outcomes': self.outcomes, 'inputs': self.inputs}, f)
        print('%s: %d pruchodu, snimky %d-%d, %s' % (
            os.path.relpath(self.out, B.ROOT), len(self.inputs), self.first_frame,
            self.frames[-1] if self.frames else 0, self.outcomes[-1] if self.outcomes else '-'))


def trace(rzx, name, out_base):
    blocks = [b.obj for b in parse_rzx(rzx)]
    snapshot, recordings = blocks[0], blocks[1:]
    if not recordings or any(not hasattr(r, 'frames') for r in recordings):
        raise SystemExit('%s: čekám snapshot a nahrávky vstupů' % rzx)
    context = RZXContext(None)
    context.snapshot = snapshot
    # 'int_active': 0 jako rzxplay.py – přerušení jen na hranici snímku
    sim = from_snapshot(CSimulator or Simulator, snapshot, config={'int_active': 0})
    context.simulator = sim
    memory, registers = sim.memory, sim.registers
    state = {'frame': 0, 'game': None, 'count': 0, 'tracer': None}

    def stop(fetch_counter, pc):
        tracer = state['tracer']
        if pc == PASS:
            game = state['game']
            if game is None:
                return
            if game.file is None:
                game.begin(memory, state['frame'])
            else:
                game.add(memory, tracer.log, state['frame'], 'pass')
            tracer.log = []
        elif pc == START:
            state['count'] += 1
            k = state['count']
            out = os.path.join(out_base, name if k == 1 else '%s-%d' % (name, k))
            state['game'] = Game(out, os.path.basename(rzx), ram64(memory))
            tracer.log = []
        elif pc == END:
            game = state['game']
            if game and game.file:
                game.add(memory, tracer.log, state['frame'], 'gameover')
                game.close()
            state['game'] = None

    for recording in recordings:
        tracer = Logger(context, recording)
        state['tracer'] = tracer
        sim.set_tracer(tracer)
        fetch_counter = tracer.next_frame()
        while fetch_counter >= 0:
            pc = sim.exec_frame(fetch_counter, None, stop)
            registers[T] = 0
            fetch_counter = tracer.next_frame()
            # přerušení na hranici snímku jako rzxplay.py (flags 0)
            if registers[IFF]:
                if memory[pc] == 0x76:
                    registers[PC] = (registers[PC] + 1) % 65536
                sim.accept_interrupt(registers, memory, 0)
            state['frame'] += 1
            context.frame_count = state['frame']
    # partie, kterou nahrávka utnula: průchody po poslední celý
    if state['game'] and state['game'].file:
        state['game'].close()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--rzx', default=RZX)
    ap.add_argument('--name', default='rzx1')
    ap.add_argument('--out', default=os.path.join(B.BUILD, 'rules'))
    args = ap.parse_args()
    if not os.path.exists(args.rzx):
        raise SystemExit('%s chybí (sources/docs/provenance.md)' % args.rzx)
    trace(args.rzx, args.name, args.out)


if __name__ == '__main__':
    main()
