#!/usr/bin/env python3
"""Záznam průchodů hlavní smyčkou originálu pro `tools/matchphysics.mjs`.

    ./tools/tracephysics.py [--script NAME | --all] [--list]

Hra se v simulátoru spustí z obrazu na vstupu (`build/entry.z80`) jako
v `playtrace.py` (start `0` ve snímku 300) a hraje se skriptem kláves
(`SCRIPTS`, po snímcích). Běží **se vším, co dělá originál** — přerušení
`$FB08` (zvuk) i sporná paměť ne, tempo se tu neměří.

Na začátku **každého průchodu** hlavní smyčkou (`$751E`) se uloží celá RAM
`$4000`–`$FFFF`. Při prvním zastavení i jako `init.bin` (64 KB s ROM) —
z ní remake startuje.

★ **Vstupy průchodu** jsou jen čtení portů: směry v `$FC94` (podle ovládání
`$FEE7` klávesnice po půlřádcích, Kempston `$1F`), `SPACE` pauzy `$73FE`
a `Q` `$81EC` (`sources/docs/disasm_notes.md`). Obsluha přerušení hraje
zvuk a hlavní smyčka z jejího stavu nic nečte (zapisuje jen požadavky
`$F061`, `$F062`). Proto se zaznamenávají **hodnoty instrukcí `IN`** tak,
jak je simulátor vrátil — `[port, hodnota]` v pořadí — a remake je dostane
v tomtéž pořadí.

Skript kláves je buď **po snímcích** (`SCRIPTS`: `(od, do, klávesa)`), nebo
**po průchodech** (`tools/physicsscripts.json`, který píše
`tools/searchphysics.mjs`): hra se spustí jako vždy (`GAME`, po snímcích)
a od prvního zaznamenaného průchodu drží klávesy podle čísla průchodu.
Tak převod a originál dostanou tutéž posloupnost a skript se dá najít
převodem.

★ **Záplata** (`patch`, {adresa: hodnota}) se do paměti dá na začátku
prvního průchodu, než se uloží `init.bin` — tak se dá do místnosti `$00`
posadit bratr (`$FE63`), ke kterému jinak vede cesta jen přes místnosti
s entitami (M4). Originál i převod pak jedou z téže záplatované paměti;
`matchphysics --from-data`, `mkmemory` a `searchphysics` takové záznamy
vynechávají (`inputs.json` nese `patch`).

★ **Start z pozdějšího průchodu** (`prefix`, (jméno, průchody)): hra se
napřed odehraje `n` průchodů záznamu `jméno` — po snímcích (`fuzz2` do
místnosti `$01`) nebo po průchodech (`ent3` do místnosti s entitami, M4),
i s jeho záplatou a startem — teprve pak se dá záplata a uloží `init.bin`;
klávesy takového záznamu jsou po průchodech od prvního zaznamenaného.
Tak se záznam dostane do místnosti, kam od startu náhodou nedojede, a na
místo, kam v ní nedojede vůbec (prázdné buňky `$01`). `inputs.json` nese
`prefix`; `matchphysics --from-data` a `mkmemory` takový záznam vynechávají
jako záplatovaný, `searchphysics --start` ho přenáší do nalezených skriptů.

★ **Start hry** (M5): paměť na `$74F3` (menu stisklo `0`, před `$7D87`) jde
do `start.bin` — remake z ní začne novou hru (`BobbyLogic.newGame`) a musí
dojít na `init.bin`; záznamy se záplatou nebo prefixem ho nemají. **Konec
hry** (`'end'`): průchody se nahrávají, dokud hra neskončí na koncové
obrazovce `$7D45` (všichni doma `$7CE5`, konec času `$7494`; `passes` je
horní mez), poslední v `outcomes` jako `gameover`.

Výstup do `build/trace/<skript>/`: `init.bin` (a `start.bin`), `passes.xor.gz`
(RAM po každém průchodu, XOR s předchozím, gzip), `inputs.json` (`inputs`:
čtení portů v každém průchodu, `outcomes`, `tstates`: konec průchodu
v T-stavech).
"""
import argparse, gzip, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as B                                                # noqa: E402
B.skoolkit_path()
sys.path.insert(0, B.RETRO)

from playtrace import KEYS, ROWS                                 # noqa: E402
from skoolkit.snapshot import Snapshot                           # noqa: E402
from skoolkit.simulator import Simulator                         # noqa: E402
from skoolkit.simutils import from_snapshot, PC              # noqa: E402
from skoolkit.trace import Tracer                                # noqa: E402
try:
    from skoolkit.csimulator import CSimulator
except ImportError:                                              # pragma: no cover
    CSimulator = None

PASS = 0x751E           # ★ začátek průchodu hlavní smyčkou
START = 0x74F3          # ★ začátek hry z menu ($D969 → $74CC): před $7D87
END = 0x7D45            # ★ konec hry: $7D06 nakreslil koncovou obrazovku, před čekáním $7D45
END_TSTATES = 69888*400  # nejvýš 400 snímků do konce hry: zvuk 6 ($7D3F) drží přerušení přes 13 snímků
OUT = os.path.join(B.BUILD, 'trace')

GAME = [(300, 310, '0')]
# ★ ovládání KEYBOARD ($FD0E): horní řada nahoru, prostřední dolů, spodní
# řada ob jednu vlevo / vpravo — P nahoru, L dolů, Z vlevo, X vpravo
UP, DOWN, LEFT, RIGHT = 'P', 'L', 'Z', 'X'
SPACE = 'SPACE'         # ★ pauza originálu ($73FE)
KEYSET = [UP, DOWN, LEFT, RIGHT, UP + LEFT, UP + RIGHT, DOWN + LEFT,
          DOWN + RIGHT, None]


def fuzz(seed, frames, start=330):
    """Hra náhodou ze semínka: směr (i úhlopříčka) nebo nic, 4–80 snímků."""
    import random
    rnd = random.Random(seed)
    out, frame = list(GAME), start
    while frame < start + frames:
        length = rnd.randint(4, 80)
        key = rnd.choice(KEYSET)
        if key:
            for k in key:
                out.append((frame, frame + length, k))
        frame += length
    return out


# ★ bratr v místnosti $00: $FE63 = 0 (jinak $07, za místností $02 se zlým
# Bearingem), jeho poloha $FE5A/$FE5B kousek od Bobbyho ($FE46/$FE47 = $30/$00)
def brother(x, y, h=0x11):
    return {0xFE63: 0, 0xFE5A: x, 0xFE5B: y, 0xFE5D: h}


# ★ záznam koule $FE42 (physics.md §3): +4 sloupec x $FE46, +5 řádek y
# $FE47 (16 na buňku, buňka mapy = 8·řádek + sloupec, $82DD), +7 výška
# $FE49, +8 rychlost pádu $FE4A; bratr $FE56 totéž o $14 výš ($FE5A,
# $FE5B, $FE5D). Rychlosti +0..+3 nula = koule stojí.
def bobby(col, row, h, **more):
    d = {0xFE46: col, 0xFE47: row, 0xFE49: h, 0xFE4A: 0,
         0xFE42: 0, 0xFE43: 0, 0xFE44: 0, 0xFE45: 0}
    d.update(more)
    return d


# ★ místnost $00: podlaha $0A (bloky $17) v řádcích 4–7, sloupec 3 je
# chodba výšky $0A mezi stěnami $12 (řádky 2–3); padající koule zrychluje
# ($8560: $FE05 + 1 za průchod od 0), takže dopad z 28/36/45/55 nad
# podlahou dá $FE05 = 7/8/9/10 → omráčení 3/4/5/2
FLOOR = 0x0A


# jméno: (skript kláves, počet průchodů[, záplata])
SCRIPTS = {
    # ★ pauza $73C0: SPACE ji začne (20 snímků), krátký SPACE (10 snímků,
    # méně než zpoždění $73EC) ji ukončí
    'pause': (GAME + [(340, 380, UP), (400, 420, SPACE), (500, 510, SPACE),
                      (540, 600, DOWN), (620, 640, SPACE), (700, 710, SPACE)], 300),
    # bratr v místnosti: stojí, Bobby do něj vráží; náhoda s bratrem u sebe
    'brother1': (GAME + [(340, 400, DOWN), (420, 480, UP), (500, 560, DOWN),
                         (580, 640, UP)], 300, brother(0x30, 0x10)),
    'brother2': (fuzz(11, 4000), 2000, brother(0x40, 0x00)),
    'brother3': (fuzz(12, 4000), 2000, brother(0x30, 0x20, 0x0A)),
    'brother4': (fuzz(13, 4000), 2000, brother(0x20, 0x10)),
    # ★ bratr dotlačený domů ($7E6B): buňka 3 místnosti $00 je domov; Bobby
    # pod ním (bez rychlosti ze vstupu) ho tlačí klávesou vlevo (−$FE47)
    'brotherhome': (GAME + [(330, 430, LEFT)], 200,
                    {0xFE63: 0, 0xFE5A: 0x30, 0xFE5B: 0x10, 0xFE5D: 0x18,
                     0xFE46: 0x30, 0xFE47: 0x20, 0xFE49: 0x11,
                     0xFE42: 0, 0xFE43: 0, 0xFE44: 0, 0xFE45: 0}),
    # ★ poslední bratr ztracený pádem ($7DF5 → $FE63 = 0): $FE35 = 1 a bratr
    # vysoko nad podlahou; další průchod je „všichni doma“ ($7CE5, M5)
    'lastbrother': (GAME, 150, {0xFE63: 0, 0xFE5A: 0x30, 0xFE5B: 0x60,
                                0xFE5D: 0x60, 0xFE35: 1}),
    # bez kláves: koule stojí, čas ubývá
    'idle': (GAME, 200),
    # jednotlivé směry a úhlopříčky po první místnosti
    'roll': (GAME + [(340, 400, UP), (420, 480, DOWN), (500, 560, LEFT),
                     (580, 640, RIGHT), (660, 700, UP), (660, 700, RIGHT),
                     (720, 800, DOWN), (720, 800, LEFT)], 400),
    'fuzz1': (fuzz(1, 4000), 2000),
    'fuzz2': (fuzz(2, 4000), 2000),
    'fuzz3': (fuzz(3, 8000), 4000),
    # ★ dlouhé pády na podlahu buňky (6, 6): omráčení 4, 5 a 2 ($8560),
    # koule po dopadu, čas ($7E19 → návrat na vstup u 4, 5 a 2)
    'fall4': (GAME + [(500, 560, LEFT)], 300, bobby(0x66, 0x66, FLOOR + 36)),
    'fall5': (GAME + [(500, 560, UP)], 300, bobby(0x66, 0x66, FLOOR + 45)),
    'fall2': (GAME + [(500, 560, RIGHT), (600, 660, DOWN)], 145,
              bobby(0x66, 0x66, FLOOR + 55)),
    # ★ prázdná buňka ($8D5F): místnost $01 (fuzz2 do ní dojede
    # v průchodu 1402) má sloupce x 0–2 prázdné, koule k nim nedojede;
    # posazená na sloupec 4 a hnaná k nim (klávesy po průchodech)
    'void1': {'prefix': ('fuzz2', 1402), 'passes': 400,
              'patch': bobby(0x40, 0x30, FLOOR),
              'keys': [(0, 80, LEFT), (120, 200, LEFT), (200, 260, UP)]},
    'void2': {'prefix': ('fuzz2', 1402), 'passes': 400,
              'patch': bobby(0x58, 0x38, FLOOR),
              'keys': [(0, 60, LEFT), (0, 60, DOWN), (100, 160, RIGHT),
                       (160, 240, LEFT), (160, 240, UP)]},
    # ★ bratr u stěny ($7EF4/$7ED5): oba v buňce (3, 3) mezi stěnami $12
    # na sloupcích 2 a 4; Bobby tlačí bratra ke stěnám
    'brotherwall': (GAME + [(330, 390, RIGHT), (400, 460, LEFT), (470, 530, UP),
                            (540, 600, DOWN), (610, 670, RIGHT)], 28,
                    bobby(0x30, 0x30, FLOOR) | brother(0x30, 0x3B, FLOOR)),
    # ★ bratr u stěny podruhé: bratr na ose x (sloupce, $FE46) před stěnou
    # sloupce 4, Bobby ho tlačí k ní (nahoru/dolů hýbe $FE46) — v brotherwall
    # ležel na ose řádků, kde stěna není
    'brotherside': (GAME + [(330, 400, DOWN), (420, 480, UP), (500, 560, DOWN),
                            (580, 640, UP)], 136,
                    bobby(0x31, 0x34, FLOOR) | brother(0x3C, 0x34, FLOOR)),
    # ★ zeď při tlačení ($7EF4/$7ED5): Bobby u skutečné stěny (bit $21
    # v $FE17 — bloky $12 vedle chodby v řádku 3 jsou rampy, ne stěny;
    # stěna je v buňce (3, 0) od sloupce 2 a v (5, 1) od sloupce 6, podle
    # záznamů bro4 a drop1) a bratr vedle něj v téže ose (rozdíl < 8),
    # o 9 dál v řádcích (< 11) — tlačení na ose stěny
    'brotherpin': (GAME + [(330, 420, UP), (440, 530, DOWN), (550, 640, UP)], 320,
                   bobby(0x31, 0x00, 0x11) | brother(0x33, 0x09, 0x11)),
    'brotherpin2': (GAME + [(330, 420, DOWN), (440, 530, UP), (550, 640, DOWN)], 320,
                    bobby(0x50, 0x12, 0x1E) | brother(0x52, 0x1B, 0x1E)),
    # ★ koule vedle sebe v ose x (rozdíl < 8) se tlačí po ose řádků ($7744,
    # stěna $FE16): Bobby u stěny v řádcích — buňky (2, 2) a (1, 4) podle
    # záznamů drop1 a drop2 — a bratr v témže sloupci o 9 řádků dál
    'brotherpin3': (GAME + [(330, 420, LEFT), (440, 530, RIGHT), (550, 640, LEFT)], 118,
                    bobby(0x21, 0x22, 0x15) | brother(0x22, 0x2B, 0x15)),
    'brotherpin4': (GAME + [(330, 420, LEFT), (440, 530, RIGHT), (550, 640, LEFT)], 115,
                    bobby(0x18, 0x41, 0x11) | brother(0x19, 0x4A, 0x11)),
    # ? ani jeden z brotherpin* větev $7EF4/$7ED5 netrefil (physics.md §9)
    # ★ obě klávesy jedné osy naráz ($8437/$8485: bity obou směrů)
    'both': (GAME + [(330, 390, UP), (330, 390, DOWN), (400, 460, LEFT), (400, 460, RIGHT),
                     (470, 530, UP), (470, 530, DOWN), (470, 530, RIGHT)], 150),
    # ★ Bobby výš než bratr ($7801 → $FE49): spadne na stojícího bratra
    'brotherjump': (GAME + [(400, 460, UP), (480, 540, LEFT)], 300,
                    bobby(0x50, 0x50, FLOOR + 0x12) | brother(0x50, 0x55, FLOOR)),
    # ★ hranice $67 při tlačení v x ($7792): bratr u pravého okraje
    'brotheredge': (GAME + [(330, 420, RIGHT), (440, 500, LEFT), (520, 600, DOWN),
                            (520, 600, RIGHT)], 300,
                    bobby(0x50, 0x5A, FLOOR) | brother(0x50, 0x65, FLOOR)),
    # ★ bratr nalezený na svém místě ($F33F → $F365): záznam místa 0 ($EE49,
    # 3 B: stav, místnost, buňka) přepsaný na místnost $00 a buňku 3, kde
    # Bobby startuje, $EE5E ≠ 0 (jinak ho $F323 dá až při přechodu); od
    # prvního průchodu $6125 = $78 a panel bliká ($9992, 480 průchodů),
    # a obě koule jsou každý průchod odemráčené
    'found1': (GAME + [(400, 460, DOWN), (500, 560, UP), (600, 700, LEFT)], 560,
               {0xEE5E: 1, 0xEE4A: 0x00, 0xEE4B: 0x03}),
    # --- M4: entity (physics.md §11) ---
    # ★ „teleport“: záznam ent2 bere v průchodu 85 východ 2 místnosti $00
    # (do $1F); záplata jeho bajtu místnosti $C856 ($C84C + 4·2 + 2) před
    # tím průchodem pošle Bobbyho do místnosti, kam od startu vede 19
    # ($51: průduch typu 6, blok typu 2) nebo 14 místností ($A2: zlý
    # Bearing s pauzami v cestě a spouštěným výtahem na jeho buňce — bit 7
    # spouštěčů $917A). Poloha příjezdu zůstává z východu místnosti $00
    'tele51': {'prefix': ('ent2', 84), 'passes': 600, 'patch': {0xC856: 0x51},
               'keys': [(0, 1, DOWN), (40, 120, UP), (140, 220, RIGHT), (240, 320, DOWN),
                        (340, 420, LEFT), (440, 520, UP), (440, 520, LEFT)]},
    'teleA2': {'prefix': ('ent2', 84), 'passes': 800, 'patch': {0xC856: 0xA2},
               'keys': [(0, 1, DOWN), (60, 120, UP), (200, 260, RIGHT), (400, 460, DOWN)]},
    # ★ bratr v místnosti s entitami (záplata jako brother*): v $02 (zlý
    # Bearing čekající na buňku $D4, dva magnety na bratra se spouštěči na
    # buňkách $2B a $28, blok na čas) na buňce $2B — ent1 do $02 vjíždí
    # v průchodu 1536; v $08 (dva průduchy typu 1 na ($30,$40) a ($40,$40))
    # na prvním průduchu — ent3 tam vjíždí v průchodu 2223
    'bro02': {'prefix': ('ent1', 1535), 'passes': 600,
              'patch': {0xFE63: 0x02, 0xFE5A: 0x38, 0xFE5B: 0x58, 0xFE5D: 0x11},
              'keys': [(0, 1, RIGHT), (29, 62, DOWN), (100, 160, UP), (200, 260, LEFT),
                       (300, 360, RIGHT), (400, 460, DOWN)]},
    'bro08': {'prefix': ('ent3', 2222), 'passes': 500,
              'patch': {0xFE63: 0x08, 0xFE5A: 0x30, 0xFE5B: 0x40, 0xFE5D: 0x11},
              'keys': [(0, 87, DOWN), (0, 87, RIGHT), (120, 180, UP), (220, 280, LEFT)]},
    # ★ bratr, kterého magnet táhne: na buňce $2B neudrží (blok $03 je svah),
    # z x = 0, y = $54 se přes spouštěcí buňku $28 ($E8) převalí a magnet
    # zabere (hledáno převodem: magnetPull 10 průchodů); bratr na buňce
    # drtiče $24 v $07 (výtah na „buňce“ $64 — crushCheck pro bratra)
    'bro02b': {'prefix': ('ent1', 1535), 'passes': 300,
               'patch': {0xFE63: 0x02, 0xFE5A: 0x00, 0xFE5B: 0x54, 0xFE5D: 0x11},
               'keys': [(0, 1, RIGHT), (29, 62, DOWN), (100, 160, UP), (200, 260, LEFT)]},
    'bro07': {'prefix': ('ent1', 2170), 'passes': 300,
              'patch': {0xFE5A: 0x40, 0xFE5B: 0x40, 0xFE5D: 0x11,
                        0xFE56: 0, 0xFE57: 0, 0xFE58: 0, 0xFE59: 0},
              'keys': [(0, 2, DOWN), (0, 2, LEFT), (60, 120, UP), (160, 220, RIGHT)]},
    # ★ výchozí stavy pro searchphysics --start: v $07 (bratr, dva výtahy
    # na „buňkách“ $64/$62 = drtič na $24/$22, spouštěný výtah; ent1 tam
    # vjíždí v průchodu 2164) a v $06 (blok typu 2, odchod ho uloží $98E1)
    'st07': {'prefix': ('ent1', 2170), 'passes': 2, 'keys': [(0, 2, DOWN), (0, 2, LEFT)]},
    'st06': {'prefix': ('ent1', 2300), 'passes': 2, 'keys': []},
    # ★ poslední bratr dotlačený domů ($7E9D → $FE63 = 0): brotherhome
    # s $FE35 = 1, domů dojde v průchodu 10; další průchod je „všichni
    # doma“ ($7CE5, M5) a originál se už do $751E nevrátí — záznam končí
    'lasthome': (GAME + [(330, 430, LEFT)], 40,
                 {0xFE63: 0, 0xFE5A: 0x30, 0xFE5B: 0x10, 0xFE5D: 0x18,
                  0xFE46: 0x30, 0xFE47: 0x20, 0xFE49: 0x11,
                  0xFE42: 0, 0xFE43: 0, 0xFE44: 0, 0xFE45: 0, 0xFE35: 1}, 'end'),
    # --- M5: konec hry (physics.md §12) ---
    # ★ všichni doma ($7CE5 → $7D06): jako lasthome, 11. průchod končí na
    # koncové obrazovce „AND THEY ALL LIVED HAPPILY EVER MORE“ ($FEF0 bez
    # ztraceného bratra); 'lostone' má jednoho ztraceného ($FEF2 = $FF) →
    # „WELL AT LEAST NOW YOU CAN HAVE DOUBLE HELPINGS“
    'lostone': (GAME + [(330, 430, LEFT)], 40,
                {0xFE63: 0, 0xFE5A: 0x30, 0xFE5B: 0x10, 0xFE5D: 0x18,
                 0xFE46: 0x30, 0xFE47: 0x20, 0xFE49: 0x11,
                 0xFE42: 0, 0xFE43: 0, 0xFE44: 0, 0xFE45: 0, 0xFE35: 1, 0xFEF2: 0xFF}, 'end'),
    # ★ konec času ($7404 → $FE55 = 1 → $7494 → GAME OVER): číslice času
    # na 1, první tik je přetočí všechny a čtvrtá dojde na 0
    'timeout': (GAME + [(330, 400, UP)], 10,
                {0xFE66: 1, 0xFE67: 1, 0xFE68: 1, 0xFE69: 1}, 'end'),
    # ★ celá hra bez záplaty od startu ($74F3 → $7D87, start.bin), bez kláves
    'newgame': (GAME, 100),
}


FRAME_T = 69888         # ★ T-stavů na snímek 48K


class Logger(Tracer):
    """Tracer, který si zapisuje každé čtení portu.

    ★ Klávesnici bere ze skriptu podle snímku, ve kterém `IN` proběhne
    (T-stavy / 69 888). SkoolKit ji jinak nastavuje až na hranici snímku
    a každé `run()` ji vynuluje — a směry se čtou hned na začátku průchodu,
    takže by je hra skoro nikdy neviděla."""

    def __init__(self, *args, script=(), passes=None):
        super().__init__(*args)
        self.log = []
        self.script = script
        self.passes = passes        # (od průchodu, do průchodu, klávesa) nebo None
        self.pass_no = -1           # číslo zaznamenávaného průchodu, -1 před prvním

    def read_port(self, registers, port):
        keyboard = [0] * 8
        if self.passes is not None and self.pass_no >= 0:
            held = [k for a, b, k in self.passes if a <= self.pass_no < b]
        else:
            frame = registers[25] // FRAME_T
            held = [k for a, b, k in self.script if a <= frame < b]
        for key in held:
            row, bit = KEYS[key]
            keyboard[ROWS[row]] |= 1 << bit
        self.keyboard = keyboard
        value = super().read_port(registers, port)
        self.log.append([port, value])
        return value


def record(name, script, passes, patch=None, by_pass=None, prefix=None, end=False):
    snap = Snapshot.get(B.ENTRY_Z80)
    cls = CSimulator or Simulator
    sim = from_snapshot(cls, snap, {}, {'ay': [None] * 16},
                        {'fast_djnz': False, 'fast_ldir': False}, None)
    tracer = Logger(sim, snap.border, snap.out7ffd, snap.outfffd,
                    list(snap.ay), snap.outfe, True, script=script, passes=by_pass)
    sim.set_tracer(tracer)
    r, mem = sim.registers, sim.memory

    def draw(scr, frame, border, keyboard):
        for i in range(8):
            keyboard[i] = 0
        for start, end, key in script:
            if start <= frame < end:
                row, bit = KEYS[key]
                keyboard[ROWS[row]] |= 1 << bit
        return True

    pc = snap.pc
    import contextlib, io

    def to_pass(pc):
        with contextlib.redirect_stdout(io.StringIO()):
            tracer.run(pc, PASS, 0, 0, True, draw, None, None, None, '$', '04X', '04X')
        return r[PC]

    def to(pc, stop, max_tstates=0):
        with contextlib.redirect_stdout(io.StringIO()):
            tracer.run(pc, stop, 0, max_tstates, True, draw, None, None, None, '$', '04X', '04X')
        return r[PC]

    # ★ start hry: paměť na $74F3 (menu stisklo 0, $D969 už nastavilo $FDEA
    # a číslice času) — z ní remake startuje novou hru (M5, BobbyLogic.newGame)
    pc = to(pc, START)
    start_mem = bytes(mem[0:0x10000])
    pc = to_pass(pc)

    def run_prefix(prefix):
        # ★ napřed n průchodů jiného záznamu — po snímcích (pass_no −1: klávesy
        # podle snímku) nebo po průchodech (jeho klávesy podle čísla průchodu),
        # i s jeho vlastní záplatou a startem (rekurzivně) — pak teprve záplata
        # a start tohohle záznamu
        prefix_name, prefix_passes = prefix
        p_script, _, p_patch, p_keys, p_prefix, _ = all_scripts()[prefix_name]
        p = pc
        if p_prefix:
            p = run_prefix(p_prefix)
        for address, value in (p_patch or {}).items():
            mem[address] = value
        tracer.script, tracer.passes = p_script, p_keys
        for n in range(prefix_passes):
            tracer.pass_no = n
            p = to_pass(p)
        return p

    if prefix:
        pc = run_prefix(prefix)
        tracer.script, tracer.passes, tracer.pass_no = script, by_pass, -1
    for address, value in (patch or {}).items():
        mem[address] = value
    out = os.path.join(OUT, name)
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, 'init.bin'), 'wb').write(bytes(mem[0:0x10000]))
    if not patch and not prefix:
        open(os.path.join(out, 'start.bin'), 'wb').write(start_mem)
    prev = bytes(mem[0x4000:0x10000])
    chunks, inputs, tstates, outcomes = [], [], [], []
    for n in range(passes):
        tracer.log = []
        tracer.pass_no = n
        if end:
            # ★ konec hry: průchod, který nekončí na $751E, ale na koncové
            # obrazovce $7D45 (všichni doma $7CE5, konec času $7494) — zkusí
            # se dojet na $751E v mezích END_TSTATES, a když tam hra nedojde,
            # od uloženého stavu znovu na $7D45; `passes` je horní mez
            saved = (list(mem[0:0x10000]), list(r), list(tracer.log))
            pc_before = pc
            pc = to(pc, PASS, END_TSTATES)
            if pc != PASS:
                mem[0:0x10000] = saved[0]
                for i, v in enumerate(saved[1]):
                    r[i] = v
                tracer.log = saved[2]
                pc = to(pc_before, END, END_TSTATES)
                if pc != END:
                    raise SystemExit('%s: hra v průchodu %d neskončila (PC $%04X)' % (name, n + 1, pc))
                outcomes.append('gameover')
            else:
                outcomes.append('pass')
        else:
            pc = to_pass(pc)
            outcomes.append('pass')
        cur = bytes(mem[0x4000:0x10000])
        chunks.append(bytes(a ^ b for a, b in zip(cur, prev)))
        prev = cur
        inputs.append(tracer.log)
        tstates.append(r[25])
        if outcomes[-1] != 'pass':
            break
    if end and outcomes[-1] == 'pass':
        raise SystemExit('%s: hra do %d průchodů neskončila' % (name, passes))
    with gzip.open(os.path.join(out, 'passes.xor.gz'), 'wb') as f:
        for c in chunks:
            f.write(c)
    json.dump({'script': [list(s) for s in script],
               'passes': [list(s) for s in by_pass] if by_pass is not None else None,
               'patch': {str(k): v for k, v in patch.items()} if patch else None,
               'prefix': list(prefix) if prefix else None,
               'start': not patch and not prefix,
               'outcomes': outcomes,
               'inputs': inputs,
               'tstates': tstates}, open(os.path.join(out, 'inputs.json'), 'w'))
    print('%s: %d pruchodu%s -> %s' % (name, len(inputs), ' (konec hry)' if outcomes and outcomes[-1] != 'pass' else '',
                                    os.path.relpath(out, B.ROOT)))


PASS_SCRIPTS = os.path.join(HERE, 'physicsscripts.json')


def all_scripts():
    """SCRIPTS a skripty po průchodech z tools/physicsscripts.json:
    jméno -> (skript po snímcích, počet průchodů, skript po průchodech)."""
    out = {}
    for k, v in SCRIPTS.items():
        if isinstance(v, dict):         # po průchodech, ze startu z pozdějšího průchodu
            out[k] = (GAME, v['passes'], v.get('patch'), [tuple(x) for x in v['keys']],
                      tuple(v['prefix']) if v.get('prefix') else None, bool(v.get('end')))
        else:
            out[k] = (v[0], v[1], v[2] if len(v) > 2 else None, None, None,
                      len(v) > 3 and v[3] == 'end')
    if os.path.exists(PASS_SCRIPTS):
        for k, v in json.load(open(PASS_SCRIPTS)).items():
            patch = {int(a): b for a, b in (v.get('patch') or {}).items()} or None
            out[k] = (GAME, v['passes'], patch, [tuple(x) for x in v['keys']],
                      tuple(v['prefix']) if v.get('prefix') else None, False)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--script', default='idle')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--list', action='store_true')
    args = ap.parse_args()
    scripts = all_scripts()
    if args.list:
        for k, (s, n, patch, p, prefix, end) in scripts.items():
            print('%-12s %5d pruchodu%s%s%s%s' % (
                k, n, ' (po pruchodech)' if p else '', ' (zaplata)' if patch else '',
                ' (od %s/%d)' % prefix if prefix else '', ' (konec hry)' if end else ''))
        return
    names = list(scripts) if args.all else [args.script]
    for name in names:
        record(name, *scripts[name])


if __name__ == '__main__':
    main()
