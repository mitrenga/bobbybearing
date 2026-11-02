#!/usr/bin/env python3
"""2. stupeň zavaděče Alkatraz krok po kroku: reference pro `tools/matchtape.mjs`.

    ./tools/mksnapshot.sh && ./tools/traceloader.py      # build/ref/loader.json (≈ 1 min)

★ Blok 4 nahrává 2. stupeň zavaděče (`$F6C9`, `sources/docs/tape_layout.md`):

- **pořadí adres obrázku** nedělá tabulka, ale generátor `$F983`: ze 70
  záznamů po 4 B (`$FB1F`) rozbalí 6 714 adres na zásobník (`$C23D` výš),
  až 8 „chodců" naráz, každý s rámcem registrů (`$FACB`, přepínání přes
  `LD SP`), kteří se střídají po bajtu — proto jsou bajty jedné buňky
  proložené se sousedními. Za obrázkem je na zásobníku statický konec
  (`$F6B1`: 0, 10 B proměnných na `$F6B7`) a dál **slova, která přijdou
  z pásky** jako těch 10 B proměnných (program 39 854 B na `$5B00`, 3 B
  na `$F6C3`, 0).
- **běžící text a počítadlo** kreslí stavový automat mezi hranami
  (`$F7AE` → `JP ($F7AF)`): **jeden krok na bit**, 8 kroků na bajt. První
  stav `$F7B1` čeká, než zbývající počet bajtů úseku (`E`) dělí 8 — během
  obrázku je úsek vždy 1 B, takže text začíná až za obrázkem (bajt 6 718,
  `E` = 8 v úseku proměnných). Dřívější „změny" řádků 22–23 je obrázek sám.

Nahrání je bez pulzů jako `bblib.memory_image()`, ale před každým bajtem
bloku 4 se automat **krokne 8×** (PC = `($F7AF)`, běh po `$F7BE`), přesně
jak ho volá smyčka bitu `$F712`. Zaznamená se:

- `order` + `picture`: adresa a dešifrovaný bajt každého z 6 714 B obrázku,
  `vars`: 10 B proměnných z pásky;
- `regions`: paměť zavaděče ve chvíli prvního bajtu bloku 4, kterou automat
  a generátor čtou (`$F6B1`, `$F97F`, `$FB1B`, `$FC37`–`$FFFF`: text, font,
  číslice) — totéž jde do `data/loading.json` (`tools/mkscreen.py`);
- `start`: registry a samomodifikované operandy před prvním krokem;
- `idle`: počet bajtů od začátku bloku, po které automat nic nedělá
  (kontroluje se), `steps`: pro každý další bit stav po kroku — stav
  (`$F7AF`), A', CY', BC', DE', HL', IY, `$F7F3`, `$F8CE`, počítadlo
  `$F980`–`$F982` a změny buněk zavaděče (offset, hodnota).

Na konci: buňky zavaděče = obrazovka na vstupu do hry (`build/entry.bin`),
obrázek bez těch buněk = `build/entry.bin` (kontrola `data/loading.json`
dělá `matchtape`).
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as B                                                # noqa: E402
import matchloading as ML                                        # noqa: E402

OVERLAY = [i for i in range(6912) if ML.cell(i) in ML.OVERLAY]
STATE = 0xF7AF          # ★ operand JP ($F7AE): stav automatu
TOGGLE = 0xF7F3         # ★ CCF / LD A,A: inverze textu
LINE_B = 0xF8CE         # ★ operand LD B,n v kroku počítadla
COUNTER = 0xF980        # ★ tři číslice počítadla (`$F8D7`)
STEP_END = 0xF7BE       # ★ čekání na druhou hranu: konec kroku
PICTURE = (2, 6716)     # ★ bajty obrázku v bloku 4
VARS = (6716, 6726)     # ★ 10 B proměnných (`$F6B7`)
# ★ co generátor a automat čtou z paměti zavaděče (start, konec za)
REGIONS = [(0xF6B1, 0xF6C7), (0xF97F, 0xF983), (0xFB1B, 0xFC37), (0xFC37, 0x10000)]
OUT = os.path.join(B.BUILD, 'ref', 'loader.json')


def main():
    B.skoolkit_path()
    from skoolkit.simutils import PC, E, IXh, IXl, IYh, IYl, xA, xF, xB, xC, xD, xE, xH, xL

    rec = {'order': [], 'picture': bytearray(), 'vars': bytearray(), 'regions': {},
           'start': None, 'idle': 0, 'steps': []}
    last = {'ix': None, 'i': None, 'cells': None}

    def word(m, a):
        return m[a] | (m[a + 1] << 8)

    def cells(m):
        return bytes(m[0x4000 + o] for o in OVERLAY)

    def snapshot_regs(r, m):
        return {'state': word(m, STATE), 'a2': r[xA], 'cy2': r[xF] & 1,
                'bc2': (r[xB] << 8) | r[xC], 'de2': (r[xD] << 8) | r[xE],
                'hl2': (r[xH] << 8) | r[xL], 'iy': (r[IYh] << 8) | r[IYl],
                'toggle': m[TOGGLE], 'lineB': m[LINE_B],
                'counter': [m[COUNTER], m[COUNTER + 1], m[COUNTER + 2]]}

    def step(sim, r, m):
        r[PC] = word(m, STATE)
        n = 0
        while r[PC] != STEP_END:
            sim.run()
            n += 1
            if n > 10000:
                raise SystemExit('krok automatu se zacyklil, PC=$%04X' % r[PC])

    def on_read(sim, k, i):
        r, m = sim.registers, sim.memory
        if k != 1:
            return
        ix = (r[IXh] << 8) | r[IXl]
        # the byte before this one is in: its decrypted value
        if last['ix'] is not None:
            j = last['i']
            if PICTURE[0] <= j < PICTURE[1]:
                rec['picture'].append(m[last['ix']])
            elif VARS[0] <= j < VARS[1]:
                rec['vars'].append(m[last['ix']])
        last['ix'], last['i'] = ix, i
        if PICTURE[0] <= i < PICTURE[1]:
            rec['order'].append(ix - 0x4000)
        if i == 0:
            for start, end in REGIONS:
                rec['regions']['%04X' % start] = bytes(m[start:end]).hex()
            rec['start'] = snapshot_regs(r, m)
            rec['start']['e'] = r[E]
        # the picture may have written into the loader's cells since the last
        # step: only what the automaton changes is recorded
        last['cells'] = cells(m)
        # ★ 8 kroků automatu, jeden na bit, s E = zbývající počet bajtů úseku
        for bit in range(8):
            before = last['cells']
            step(sim, r, m)
            now = cells(m)
            regs = snapshot_regs(r, m)
            idle = (regs['state'] == 0xF7B1 and now == before and not rec['steps'])
            if idle:
                continue
            if not rec['steps']:
                rec['idle'] = i * 8 + bit
            changes = [[OVERLAY[c], now[c]] for c in range(len(OVERLAY)) if now[c] != before[c]]
            rec['steps'].append([regs['state'], regs['a2'], regs['cy2'], regs['bc2'], regs['de2'],
                                 regs['hl2'], regs['iy'], regs['toggle'], regs['lineB'],
                                 regs['counter'], r[E], changes])
            last['cells'] = now

    mem, r, used = B.memory_image(on_read=on_read)
    # the last byte of the tail is not followed by a read: its value is not needed
    entry = B.ram(B.ENTRY_Z80)
    final = cells(mem)
    diffs = sum(1 for c, o in enumerate(OVERLAY) if final[c] != entry[o])
    picture = sum(1 for o in range(6912) if o not in set(OVERLAY)
                  and mem[0x4000 + o] != entry[o])
    rec['picture'] = rec['picture'].hex()
    rec['vars'] = rec['vars'].hex()
    rec['cells'] = OVERLAY
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(rec, open(OUT, 'w'), separators=(',', ':'))
    print('%s: %d adres obrazku, %d B obrazku, %d B promennych, automat necinny %d bitu, %d kroku'
          % (os.path.relpath(OUT, B.ROOT), len(rec['order']), len(rec['picture']) // 2,
             len(rec['vars']) // 2, rec['idle'], len(rec['steps'])))
    print('bunky zavadece na konci / vstup do hry: %d kontrol, %d rozdilu; obrazek: %d rozdilu'
          % (len(OVERLAY), diffs, picture))
    return 1 if diffs or picture else 0


if __name__ == '__main__':
    sys.exit(main())
