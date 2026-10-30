#!/usr/bin/env python3
"""Co zavaděč Alkatraz kreslí během bloku 4: běžící text a počítadlo.

    ./tools/traceoverlay.py          # data/overlay.json (≈ 2,5 min)

★ Druhý stupeň zavaděče kreslí na řádky 22–23 (`FROM THE EDGE ......`
a počítadlo `000`) **mezi hranami**: každý bit volá jednou `JP ($F7AF)`
a stavový automat (`$F7B1`, `$F7DC`, `$F7FB`, `$F847`, `$F86E`, `$F886`,
`$F8D7`) udělá jeden krok — posun textu `RL (HL)` s ukazatelem IY, nebo
krok počítadla na `$FEE5` (`sources/docs/tape_layout.md`). Kroky běží i
v pilotu, a kolik jich proběhne, než přijdou data, závisí na tom, kdy
zavaděč začne poslouchat — proto se to nebere z kódu, ale ze **simulovaného
nahrání pulz po pulzu** (SkoolKit `tap2sna.py`, jako `tools/mksnapshot.sh`).

V každém snímku ULA nástroj porovná buňky zavaděče (`matchloading.OVERLAY`)
s minulým snímkem a změnu přiřadí k místu na pásce podle registru IX —
adresy, kam zavaděč uloží další bajt bloku 4 (EXX ho nemění):

- IX v hlavičce, obrázku (pořadí z `data/loading.json`), proměnných
  a programu → pořadové číslo bajtu bloku 4: změna se v remaku provede po
  události `tapeByte` toho bajtu (`bytes`); za posledním bajtem (IX
  `$F6C6`) s koncem bloku
- ★ v pilotu zavaděč nic nekreslí (první změna je u bajtu 1363); kdyby
  kreslil, nástroj skončí chybou

Ukládá se po každé změně **celý stav** buněk zavaděče (261 B), za sebou
a zkomprimovaný zlib (≈ 116 KB místo 3,5 MB po jednotlivých bajtech);
prohlížeč ho rozbalí `DecompressionStream('deflate')`.

Výsledek se ověří: buňky zavaděče po poslední změně = obrazovka simulátoru
na vstupu do hry (`build/entry.bin`); `tools/matchtape.mjs` to přepočítá
z dat.
"""
import base64, json, os, sys, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as B                                                # noqa: E402
import matchloading as ML                                        # noqa: E402
sys.path.insert(0, B.SKOOLKIT)
from skoolkit import tap2sna                                     # noqa: E402

OVERLAY = [i for i in range(6912) if ML.cell(i) in ML.OVERLAY]
BLOCK4_FIRST = 2           # ★ obrázek od bajtu 2 bloku 4
HEADER = 0xF6C7            # ★ bajty 0-1
VARS = 0xF6B7              # ★ bajty 6716-6725
PROGRAM = 0x5B00           # ★ bajty 6726-46579
TAIL = 0xF6C3              # ★ bajty 46580-46582


def index_map(order):
    """Adresa, kam jde další bajt -> pořadové číslo toho bajtu v bloku 4."""
    m = {HEADER: 0, HEADER + 1: 1}
    for i, off in enumerate(order):
        m[0x4000 + off] = BLOCK4_FIRST + i
    n = BLOCK4_FIRST + len(order)
    for k in range(10):
        m[VARS + k] = n + k
    n += 10
    for k in range(0xF6AE - PROGRAM):
        m[PROGRAM + k] = n + k
    n += 0xF6AE - PROGRAM
    for k in range(3):
        m[TAIL + k] = n + k
    # ★ po posledním bajtu: IX = $F6C6, změny po něm patří ke konci bloku
    m[TAIL + 3] = n + 3
    return m


def main():
    loading = json.load(open(os.path.join(B.ROOT, 'data', 'loading.json')))
    where = index_map(loading['order'])
    captured = {}

    class Tracer(tap2sna.LoadTracer):
        def __init__(self, simulator, *args, **kwargs):
            super().__init__(simulator, *args, **kwargs)
            captured['sim'] = simulator

    tap2sna.LoadTracer = Tracer
    state = {'last': None, 'stage2': False, 'pilot_t': None}
    pilot, by_byte = [], {}

    class Screen:
        def draw(self, scr, frame, border=None, *rest):
            sim = captured.get('sim')
            if sim is None:
                return True
            r = sim.registers
            pc = r[24]
            cells = bytes(scr[i] for i in OVERLAY)
            if not state['stage2']:
                # ★ 2. stupeň: okraj modrý ($F6DA, $F7D1)
                if 0xF6C9 <= pc < 0xF930:
                    state['stage2'] = True
                    state['pilot_t'] = r[25]
                    state['last'] = cells
                return True
            if cells == state['last']:
                return True
            change = [[OVERLAY[k], cells[k]] for k in range(len(OVERLAY))
                      if state['last'] is None or cells[k] != state['last'][k]]
            state['last'] = cells
            ix = (r[8] << 8) | r[9]       # IXh, IXl
            if ix in where:
                by_byte.setdefault(where[ix], []).extend(change)
            else:
                pilot.append([round((r[25] - state['pilot_t']) / 3500), change])
            return True

    tap2sna.get_screen = lambda *a, **k: Screen()
    os.makedirs(B.BUILD, exist_ok=True)
    snap = os.path.join(B.BUILD, 'overlay_loaded.z80')
    tap2sna.main(['--screen', '--start', '0x%04X' % B.ENTRY, '-c', 'finish-tape=1',
                  B.TAPE, snap])

    # ověření: konec = obrazovka na vstupu
    entry = B.ram(B.ENTRY_Z80)
    final = {}
    # v časovém pořadí: pilot před daty, data po bajtech
    for t, change in pilot:
        for off, v in change:
            final[off] = v
    for k in sorted(by_byte):
        for off, v in by_byte[k]:
            final[off] = v
    diffs = [off for off in OVERLAY if final.get(off, 0) != entry[off]]
    if pilot:
        sys.exit('zavadec kreslil uz v pilotu (%d zmen): data na to nejsou staveny' % len(pilot))
    # po každé změně celý stav buněk zavaděče (len(OVERLAY) bajtů), za sebou,
    # zlib — bajty po bajtu by byly 3,5 MB
    state = bytearray(len(OVERLAY))
    index = {off: k for k, off in enumerate(OVERLAY)}
    keys, states = sorted(by_byte), bytearray()
    for k in keys:
        for off, v in by_byte[k]:
            state[index[off]] = v
        states += state
    out = {
        'note': 'Kresleni zavadece behem bloku 4 (tools/traceoverlay.py): cells = offsety '
                'bunek radku 22-23 ve videopameti; bytes = poradova cisla bajtu bloku 4, '
                'po kterych se kresleni zmenilo (cislo za poslednim bajtem = konec bloku); '
                'states = zlib, base64: po kazde zmene stav vsech cells, za sebou.',
        'cells': OVERLAY,
        'bytes': keys,
        'states': base64.b64encode(zlib.compress(bytes(states), 9)).decode(),
    }
    json.dump(out, open(os.path.join(B.ROOT, 'data', 'overlay.json'), 'w'))
    print('pilot: %d zmen, bajty: %d zmen (od bajtu %s do %s)' % (
        len(pilot), len(by_byte), min(by_byte) if by_byte else '-', max(by_byte) if by_byte else '-'))
    print('bunky zavadece na konci / vstup do hry: %d kontrol, %d rozdilu' % (len(OVERLAY), len(diffs)))
    return 1 if diffs else 0


if __name__ == '__main__':
    sys.exit(main())
