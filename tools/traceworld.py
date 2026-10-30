#!/usr/bin/env python3
"""Reference místností z běžícího originálu: buffer scény, mapa, východy, obrazovka.

    ./tools/traceworld.py [--rooms 0-244] [--base build/world/ram00690.bin]

Výchozí stav je RAM hry v první místnosti (`playtrace.py --script "300:310:0"
--dump 690`, jen když chybí). Z té **jedné kopie paměti** se pro každou
místnost `n` (`$FE4F = n`) zavolá to, co originál dělá při vstupu do
místnosti (`sources/docs/world.md`):

1. `$808C` — buffer scény `$CDE7` (6144 B, 32 B na řádek) samé `$FF`
2. `$7935` — stavba místnosti z proudu dat: bloky `$8052` do bufferu,
   mapa `$5EEC`, seznam `$C8C8`, východy se šipkami `$C84B`/`$809D`,
   na `$7CC6` předání `$9629` (entity, M4) a na `$7CD6` atribut místnosti
3. `$9387` — přenos bufferu na obrazovku po dvanácti obdélnících

Přerušení jsou zakázaná. Zapíše se stav **na `$7CC6`** (před entitami: to je
statická scéna, kterou kreslí `app/worldRenderer.js`), stav **na konci**
(atribut, adresa atributu v proudu = HL na `$7CD6`) a obrazovka po `$9387`.
Na `$7CC6` se navíc zapíšou **všechny změny RAM** proti výchozí kopii (bez
zásobníku nástroje): proti nim `tools/matchworld.mjs` kontroluje i proměnné.
Totéž na `$7CD6`, tedy po nahrání entit `$9629`: proti tomu se kontroluje
`roomEntities` z `app/bobbyLogic.js`.

Při tom se počítá, **které adresy statická stavba čte**, než je sama zapíše,
a úsek proudu od entit po atribut: to jsou data, která `tools/dumpworld.py` vyveze do
`data/world.json`.

Výstup `build/world/rooms.json` (base64) a `build/world/reads.json`.
"""
import argparse, base64, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as B                                                # noqa: E402
B.skoolkit_path()
from skoolkit.simulator import Simulator                         # noqa: E402
from skoolkit.simutils import PC, SP, H, L                       # noqa: E402

OUT = os.path.join(B.BUILD, 'world')
BASE = os.path.join(OUT, 'ram00690.bin')

ROOM = 0xFE4F           # ★ číslo místnosti
ROOMS = 0xEC54          # ★ ukazatele na proudy místností, 245 slov
COUNT = 245             # ★ místnosti $00-$F4 (průchod přes východy: 243 + $1E, $99)
CLEAR = 0x808C          # ★ buffer samé $FF
BUILD = 0x7935          # ★ stavba místnosti
ENTITIES = 0x7CC6       # ★ CALL $8DE7 = $9629, entity (M4)
ATTR = 0x7CD6           # ★ A = (HL) atribut místnosti, výplň $5800
COPY = 0x9387           # ★ buffer -> obrazovka po obdélnících
BUFFER = 0xCDE7
MAP = 0x5EEC            # ★ 64 buněk po 2 B (výška, blok)
LIST = 0xC8C8           # ★ počet + záznamy po 6 B (bloky s bitem 7)
EXITS = 0xC84B          # ★ počet + záznamy po 4 B
RETURN = 0x0000


class Watched(bytearray):
    """64K paměti, která si pamatuje první čtení před zápisem."""

    def __init__(self, data):
        super().__init__(data)
        self.reads = set()
        self.written = set()
        self.pcs = set()

    def data_reads(self):
        """Čtení bez bajtů instrukcí (operandy samomodifikovaného kódu
        jsou kód, ne data)."""
        code = set()
        for pc in self.pcs:
            code.update(range(pc, pc + 4))
        return self.reads - code

    def __getitem__(self, i):
        if isinstance(i, int) and i >= 0x4000 and i not in self.written:
            self.reads.add(i)
        return bytearray.__getitem__(self, i)

    def __setitem__(self, i, v):
        if isinstance(i, int):
            self.written.add(i)
        bytearray.__setitem__(self, i, v)


def base_ram():
    if not os.path.exists(BASE):
        subprocess.run([os.path.join(HERE, 'playtrace.py'), '--script', '300:310:0',
                        '--frames', '700', '--shots', '690', '--dump', '690',
                        '--out', OUT], check=True)
    return open(BASE, 'rb').read()


def call(sim, mem, address, stops=None, limit=20_000_000):
    """CALL address s návratem na $0000; `stops` = {adresa: funkce(sim)}."""
    r = sim.registers
    r[SP] = 0x619C
    bytearray.__setitem__(mem, 0x619C, RETURN & 255)
    bytearray.__setitem__(mem, 0x619D, RETURN >> 8)
    r[PC] = address
    n = 0
    pcs = getattr(mem, 'pcs', None)
    while r[PC] != RETURN:
        if pcs is not None:
            pcs.add(r[PC])
        if stops and r[PC] in stops:
            stops[r[PC]](sim)
        sim.run()
        n += 1
        if n > limit:
            raise RuntimeError('$%04X: nevratilo se (PC $%04X)' % (address, r[PC]))


def b64(b):
    return base64.b64encode(bytes(b)).decode('ascii')


STACK = (0x6180, 0x61A0)  # zásobník volání nástroje, ne stav hry


def changes(mem, ram):
    """Změny RAM proti výchozí kopii jako úseky [adresa, base64]."""
    out, start = [], None
    for a in range(0x4000, 0x10001):
        changed = (a < 0x10000 and not STACK[0] <= a < STACK[1]
                   and bytearray.__getitem__(mem, a) != ram[a - 0x4000])
        if changed and start is None:
            start = a
        elif not changed and start is not None:
            out.append([start, b64(bytearray.__getitem__(mem, slice(start, a)))])
            start = None
    return out


def trace_room(ram, n):
    mem = Watched(B.rom48() + ram)
    bytearray.__setitem__(mem, ROOM, n)
    mem.written.add(ROOM)
    sim = Simulator(mem, {'PC': CLEAR, 'SP': 0x619E})
    out = {'room': n}

    def at_entities(s):
        cnt = mem[LIST]
        k = mem[EXITS]
        out['static'] = {
            'buffer': b64(bytearray.__getitem__(mem, slice(BUFFER, BUFFER + 6144))),
            'map': b64(bytearray.__getitem__(mem, slice(MAP, MAP + 128))),
            'list': b64(bytearray.__getitem__(mem, slice(LIST, LIST + 1 + 6 * cnt))),
            'exits': b64(bytearray.__getitem__(mem, slice(EXITS, EXITS + 1 + 4 * k))),
            'stream': s.registers[H] * 256 + s.registers[L],
            'changes': changes(mem, ram),
        }

    def at_attr(s):
        out['attrAddress'] = s.registers[H] * 256 + s.registers[L]
        # ★ po $9629: entity místnosti nahrané (app/bobbyLogic.js roomEntities)
        out['entities'] = changes(mem, ram)

    call(sim, mem, CLEAR)
    call(sim, mem, BUILD, {ENTITIES: at_entities, ATTR: at_attr})
    out['attr'] = mem[0x5800]
    out['buffer'] = b64(bytearray.__getitem__(mem, slice(BUFFER, BUFFER + 6144)))
    out['map'] = b64(bytearray.__getitem__(mem, slice(MAP, MAP + 128)))
    call(sim, mem, COPY)
    out['screen'] = b64(bytearray.__getitem__(mem, slice(0x4000, 0x5B00)))
    return out


class Stop(Exception):
    pass


def stop(sim):
    raise Stop()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--rooms', default='0-%d' % (COUNT - 1))
    args = ap.parse_args()
    a, _, b = args.rooms.partition('-')
    rooms = range(int(a, 0), int(b or a, 0) + 1)
    ram = base_ram()
    # ★ ROM pro tools/matchworld.mjs: entity místnosti $99 čtou tabulku až za $FFFF
    open(os.path.join(OUT, 'rom48.bin'), 'wb').write(B.rom48())
    reads = set()
    result = []
    for n in rooms:
        # data M2: co čte statická stavba (do $7CC6) a proud od entit po
        # atribut; tabulky entit (M4) sem nepatří
        mem = Watched(B.rom48() + ram)
        bytearray.__setitem__(mem, ROOM, n)
        mem.written.add(ROOM)
        sim = Simulator(mem, {'PC': CLEAR, 'SP': 0x619E})
        call(sim, mem, CLEAR)
        try:
            call(sim, mem, BUILD, {ENTITIES: stop})
        except Stop:
            pass
        out = trace_room(ram, n)
        reads |= mem.data_reads()
        reads.update(range(out['static']['stream'], out['attrAddress'] + 1))
        result.append(out)
        print('mistnost $%02X: atribut $%02X, %d vychodu' % (
            n, out['attr'], base64.b64decode(out['static']['exits'])[0]))
    os.makedirs(OUT, exist_ok=True)
    json.dump({'base': os.path.relpath(BASE, B.ROOT), 'rooms': result},
              open(os.path.join(OUT, 'rooms.json'), 'w'))
    json.dump(sorted(reads), open(os.path.join(OUT, 'reads.json'), 'w'))
    print('%d mistnosti -> build/world/rooms.json, %d ctenych adres -> reads.json'
          % (len(result), len(reads)))


if __name__ == '__main__':
    main()
