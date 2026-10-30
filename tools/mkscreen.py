#!/usr/bin/env python3
"""Obrazovky originálu pro remake: `data/screen.json`, `data/loading.json`
a referenční snímky pro `tools/matchscreen.mjs`.

    ./tools/mksnapshot.sh && ./tools/mkscreen.py

★ **Úvodní obrazovka se neopisuje z běhu, skládá se z programu**: `title`
jsou bajty programu `$DA30`–`$E515` (zabalený obrázek), které rozbalí
`$D9D8` — v remaku `app/screenComposer.js` `unpack`. Reference
`build/ref/title.scr` je obrazovka simulátoru zastaveného hned za
`CALL $D9D8` (`$D6BA`), kde smyčka menu ještě nic nenakreslila.

Herní obrazovku `screen.json` nenese: místnosti skládá worker z dat
programu (`data/world.json`, `tools/dumpworld.py`, M2).

`data/loading.json`: loading screen z kazety a **pořadí, v jakém ho
zavaděč odkrývá** (★ blok 4, bajty 2–6715, `sources/docs/tape_layout.md`):
`order` jsou offsety ve videopaměti po bajtech bloku, hodnota je bajt, jak
ho zavaděč dešifruje, tj. bajt obrazovky na konci nahrávání
(`bblib.memory_image()`). Každá adresa se zapíše jednou — nástroj to hlídá.
"""
import base64, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as L                                                # noqa: E402

TITLE_DATA = 0xDA30     # ★ LD HL,$DA30 na $D9D8
TITLE_END = 0xE516      # ★ kam $D9D8 dojde, když je obrazovka plná
TITLE_DRAWN = 0xD6BA    # ★ návrat z CALL $D9D8
MENU_FIRST = 0xD6CC     # ★ návrat z CALL $D8F5: míč v „O" nakreslený poprvé
BOUNCE_BUFFER = 0xDA30  # ★ buffer míče 4 B × 64 řádků (zbytek po rozbaleném obrázku)
BOUNCE_SPRITES = (0xCDFB, 0xCDFF)   # ★ dva snímky míče, 4 B × 25 řádků s krokem 32
FONT = 0xF70C           # ★ font hry: 8 B na znak podle kódu ASCII ($7315), mezera, 0-9 a A-Z
FONT_FIRST, FONT_END = 0x20, 0x5B
PICTURE_FIRST = 2       # ★ první bajt obrázku v bloku 4
PICTURE_END = 6716      # ★ za posledním bajtem obrázku


def title_reference():
    """Obrazovka simulátoru hned za CALL $D9D8 (6912 B)."""
    L.skoolkit_path()
    from skoolkit.snapshot import Snapshot
    from skoolkit.simulator import Simulator
    from skoolkit.simutils import from_snapshot, PC
    sim = from_snapshot(Simulator, Snapshot.get(L.ENTRY_Z80))
    r = sim.registers
    while r[PC] != TITLE_DRAWN:
        sim.run()
    return bytes(sim.memory[0x4000:0x5B00])


def menu_bounce():
    """★ Míč v „O" smyčky menu (`$D90A`): sprajty, buffer a stav ve chvíli
    hned za `CALL $D8F5` — odkud se otáčí `app/screenComposer.js` `menuLoop`."""
    L.skoolkit_path()
    from skoolkit.snapshot import Snapshot
    from skoolkit.simulator import Simulator
    from skoolkit.simutils import from_snapshot, PC
    sim = from_snapshot(Simulator, Snapshot.get(L.ENTRY_Z80))
    r, mem = sim.registers, sim.memory
    while r[PC] != MENU_FIRST:
        sim.run()
    sprites = {}
    for a in BOUNCE_SPRITES:
        rows = bytearray()
        for row in range(25):
            rows += bytes(mem[a + 32 * row:a + 32 * row + 4])
        sprites['%04X' % a] = b64(rows)
    return {
        'note': 'Mic v O smycky menu ($D90A, $D941, $D9B6): buffer = $DA30 4x64 B za '
                'CALL $D8F5, sprites = $CDFB/$CDFF 4x25 B (krok 32), pos/vel = $D940/$D93F (LD BC,($D93F): C rychlost, B poloha), '
                'sprite = $D967, toggle = $DA0C (lichy = otocka s micem).',
        'buffer': b64(mem[BOUNCE_BUFFER:BOUNCE_BUFFER + 256]),
        'sprites': sprites,
        'pos': mem[0xD940], 'vel': mem[0xD93F],
        'sprite': '%04X' % (mem[0xD967] | (mem[0xD968] << 8)),
        'toggle': mem[0xDA0C],
    }


def reveal_order():
    """Offsety videopaměti, kam jdou bajty obrázku v bloku 4, a obrazovka na
    konci nahrávání."""
    L.skoolkit_path()
    from skoolkit.snapshot import Snapshot
    from skoolkit.simulator import Simulator
    from skoolkit.simutils import from_snapshot, PC, F, L as RL, IXh, IXl
    sim = from_snapshot(Simulator, Snapshot.get(L.ATUSR_Z80))
    r, mem = sim.registers, sim.memory
    streams = [b['raw'] for b in L.turbo_blocks()]
    used = [0, 0]
    order = []
    while r[PC] != L.ENTRY:
        pc = r[PC]
        if pc in L.SKIPS:
            r[PC] = L.SKIPS[pc]
            continue
        if pc in L.READS:
            k, ret = L.READS[pc]
            if k == 1 and PICTURE_FIRST <= used[1] < PICTURE_END:
                ix = (r[IXh] << 8) | r[IXl]
                order.append(ix - 0x4000)
            r[RL] = streams[k][used[k]]
            used[k] += 1
            r[F] |= 1
            r[PC] = ret
            continue
        sim.run()
    return order, bytes(mem[0x4000:0x5B00])


def b64(data):
    return base64.b64encode(bytes(data)).decode()


def main():
    os.makedirs(os.path.join(L.BUILD, 'ref'), exist_ok=True)
    data = os.path.join(L.ROOT, 'data')
    os.makedirs(data, exist_ok=True)
    entry = L.ram(L.ENTRY_Z80)
    packed = entry[TITLE_DATA - 0x4000:TITLE_END - 0x4000]
    ref = title_reference()
    open(os.path.join(L.BUILD, 'ref', 'title.scr'), 'wb').write(ref)
    screen = {
        'note': 'Obrazovky originalu (tools/mkscreen.py): title = bajty programu '
                '$DA30-$E515, zabaleny obrazek, ktery rozbali $D9D8 '
                '(app/screenComposer.js unpack). Mistnosti sklada worker z data/world.json.',
        'title': {'address': TITLE_DATA, 'length': len(packed), 'bytes': b64(packed)},
        'menu': menu_bounce(),
        # ★ the game's own font for the remake's menu (operator 2026-10-30):
        # the glyphs of ' ', '0'-'9' and 'A'-'Z' as the program holds them
        # ($F70C + 8 × ASCII); the rest of the table is other data
        'font': {'address': FONT + 8 * FONT_FIRST, 'first': FONT_FIRST, 'end': FONT_END,
                 'bytes': b64(entry[FONT + 8 * FONT_FIRST - 0x4000:FONT + 8 * FONT_END - 0x4000])},
    }
    json.dump(screen, open(os.path.join(data, 'screen.json'), 'w'), indent=1)

    order, loaded = reveal_order()
    if len(order) != len(set(order)):
        sys.exit('zavadec zapisuje nekterou adresu obrazku dvakrat')
    loading = {
        'note': 'Loading screen z kazety (tools/mkscreen.py): videoRAM = obrazovka na '
                'konci nahravani (bblib.memory_image), order = offsety ve videopameti '
                'po bajtech obrazku v bloku 4 (bajty %d-%d), v poradi odkryvani.'
                % (PICTURE_FIRST, PICTURE_END - 1),
        'name': 'LOADING SCREEN', 'width': 256, 'height': 192,
        'videoRAM': b64(loaded),
        'pictureBytes': [PICTURE_FIRST, PICTURE_END - PICTURE_FIRST],
        'order': order,
    }
    json.dump(loading, open(os.path.join(data, 'loading.json'), 'w'))
    print('data/screen.json: title %d B z $%04X, menu (mic v O: buffer 256 B, 2 sprajty, '
          'stav %s), font %d znaku; build/ref/title.scr' % (len(packed), TITLE_DATA,
          {k: screen['menu'][k] for k in ('pos', 'vel', 'sprite', 'toggle')}, FONT_END - FONT_FIRST))
    print('data/loading.json: %d B obrazku v poradi odkryvani, %d bajtu obrazovky '
          'zavadec neplni' % (len(order), 6912 - len(order)))


if __name__ == '__main__':
    main()
