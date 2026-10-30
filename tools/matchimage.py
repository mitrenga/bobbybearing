#!/usr/bin/env python3
"""Obraz paměti z kazety proti dvěma dalším obrazům téhož programu.

    ./tools/mksnapshot.sh && ./tools/matchimage.py

Nejdřív dvě cesty od kazety k paměti, které se nesmí rozejít vůbec:
bblib.memory_image() (zavaděč na CPU, bajty rovnou z TZX, bez pulzů) proti
simulovanému nahrání pulz po pulzu (build/entry.z80). Výjimka jsou jen buňky
řádku 23, do kterých zavaděč během nahrávání kreslí běžící text a počítadlo
(matchloading.OVERLAY): bez pulzů se kreslení přeskočí. Registry na vstupu
se porovnávají kromě IY (ukazatel běžícího textu zavaděče; hra IY nepoužívá,
v disassembly není ani jednou).

Pak tři obrazy, které se nesmí rozejít jinde než tam, kde hra sama píše:

- **kazeta** — build/entry.z80 (tools/mksnapshot.sh): simulované nahrání
  `Bobby Bearing.tzx` pulz po pulzu přes BASIC a zavaděč Alkatraz, zastavené
  na první instrukci hry `$D6B6` (bblib.ENTRY)
- **RZX** — úvodní snapshot nahrávky celé partie `bobbybearing.rzx` (RZX
  Archive, SPIN 0.5, 128K): po nahrání, v menu (PC `$D8A8`)
- **Z80** — `Bobby_Bearing_1986_The_Edge_Software.z80`: nezávislý dump
  (operátor 2026-10-29: není pořízený z té kazety), uložený **na konci hry**
  (PC `$7D4A`, IM 2)

Rozdíl je **vysvětlený**, když:

1. tentýž bajt změní hra sama v některém z běhů `RUNS` — start z kazety
   (`entry`) nebo ze snapshotu Z80 (`z80`), pevný skript kláves, RAM po
   několika snímcích (tools/playtrace.py); průzkumné běhy mají skript
   z pevného generátoru (`explore_script`), takže se opakují;
2. ho změní hra v **nahrávce celé partie** (tools/playrzx.py, RAM po
   1000 snímcích proti úvodnímu snapshotu RZX);
3. bajt zapisuje instrukce s pevnou adresou (`stored`);
4. úsek je vysvětlený rozborem (`ANALYZED`, každý s důvodem);
5. jen u Z80: **kazeta a RZX se shodují, celá partie bajt nezmění**, a Z80
   má jiný — vada snapshotu Z80, ne jiný program (`z80 sam`).

Akceptace je srovnání kazety s RZX (body 1, 2 a 3, nic dalšího) a kazety se
Z80. Milník chce nulu nevysvětlených v obou.

Běží ≈ 4 minuty (průzkumné běhy po 30 000 snímcích, celá nahrávka RZX).
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as L          # noqa: E402
import playtrace           # noqa: E402
import playrzx             # noqa: E402
import matchloading        # noqa: E402

RZX_START = os.path.join(L.BUILD, 'rzx', 'bobbybearing.rzx.001.z80')

# Klávesa `0` = start hry (★ $D70A, bit 0 řádku $EF); ve hře klávesy
# podle návodu (Y–P, H–ENTER, spodní řada), `Q` cheat, `SPACE` pauza.
EXPLORE_KEYS = ['P', 'H', 'Y', 'ENTER', 'Z', 'SPACE', 'U', 'J', 'O', 'L', 'X', 'M']


def explore_script(seed, frames):
    """Start a pak klávesy z pevného LCG: (od, do, klávesa) jako text."""
    out, f, x = ['300:310:0'], 400, seed
    while f < frames:
        x = (x * 1103515245 + 12345) & 0x7FFFFFFF
        d = 60 + (x >> 8) % 400
        out.append('%d:%d:%s' % (f, f + d, EXPLORE_KEYS[x % len(EXPLORE_KEYS)]))
        f += d
    return ','.join(out)


# (jméno, odkud, skript kláves, snímky s výpisem RAM)
RUNS = [
    ('menu', 'entry', '', (50, 400, 1200)),
    ('start', 'entry', '300:310:0', (320, 600, 1490)),
    ('walk', 'entry', '300:310:0,400:700:P,700:1000:H,1000:1300:Y,1300:1600:ENTER,'
                      '1600:1900:Z,1900:2200:SPACE,2200:2500:Q', (600, 1500, 2990)),
    # čas doběhne do konce (★ ≈ 114 000 snímků) a hra skončí na `$71AF`
    ('timeout', 'entry', '300:310:0', (5000, 30000, 60000, 90000, 110000,
                                       115000, 118000, 120000, 125000, 130000)),
] + [('explore%d' % k, 'entry', explore_script(k, 30000), tuple(range(2000, 30001, 2000)))
     for k in (1, 2, 3, 4)] + [
    # ze snapshotu: konec hry -> `$71AF` (obrazovka po hře)
    ('z_idle', 'z80', '', (100, 600, 1500)),
    ('z_keys', 'z80', '200:210:0,300:600:P,600:900:H,900:1200:Y,1200:1500:ENTER',
     (400, 900, 1490)),
    ('z_long', 'z80', '', (3000, 6000, 10000, 15000, 20000)),
]

# (od, do včetně, důvod) — rozdíly vysvětlené rozborem, ne během.
# U pracovních oblastí se vypíše, kolik jejich bajtů běhy a partie změnily.
ANALYZED = [
    (0x72D7, 0x72DC,
     'barvy radku voleb ovladani na obrazovce po hre: vybrana $78, ostatni $58 '
     '($7228); $724E zapise $78 na $72D7+($72D6). Hrac snapshotu Z80 mel CURSOR '
     '(index 2), hrac RZX klavesnici'),
    (0xFF00, 0xFFFF,
     'na vstupu font, ve hre buffer (LD HL,$FF00 na $7B5E, $80EF, $810D; '
     'LD HL,$FF78 na $7513, $7868, $82A1, $91EE, $9522)'),
]


def runs_written(images):
    """Adresy (od $4000), které hra změnila proti výchozímu obrazu v běhu;
    `images` = {'entry': (snapshot, ram), 'z80': (…)}. Vrací {jméno: set}."""
    out = {}
    for name, start, script, dumps in RUNS:
        snap, base = images[start]
        d = os.path.join(L.BUILD, 'matchimage', name)
        playtrace.run(snap, max(dumps) + 1, d, None,
                      playtrace.parse_script(script), (), set(dumps))
        w = set()
        for f in dumps:
            ram = open(os.path.join(d, 'ram%05d.bin' % f), 'rb').read()
            w |= {i for i in range(len(ram)) if ram[i] != base[i]}
        out[name] = w
    return out


def rzx_written():
    """Úvodní RAM nahrávky RZX a adresy, které celá partie změní."""
    d = os.path.join(L.BUILD, 'rzx')
    if not os.path.isfile(RZX_START):
        os.makedirs(d, exist_ok=True)
        L.skoolkit_path()
        from skoolkit import rzxinfo
        # rzxinfo --extract píše do aktuálního adresáře
        cwd = os.getcwd()
        os.chdir(d)
        try:
            rzxinfo.main(['--extract', playrzx.RZX])
        finally:
            os.chdir(cwd)
    start = _ram48(RZX_START)
    rec, ctx = playrzx.play(out=d, every=1000)
    w = set()
    for f in rec.saved:
        ram = open(f, 'rb').read()
        w |= {i for i in range(len(ram)) if ram[i] != start[i]}
    return start, w, ctx.frame_count


def _ram48(path):
    """RAM `$4000`–`$FFFF` snapshotu 128K se stránkou 0 na `$C000`."""
    L.skoolkit_path()
    from skoolkit.snapshot import Snapshot
    return bytes(Snapshot.get(path).ram(0))


# ★ zápis do pevné adresy: LD (nn),A / LD (nn),HL a 16bitové LD (nn),rr,
# LD (nn),IX/IY. Hodnota: kolik bajtů od nn zapisuje.
STORES = {(0x32,): 1, (0x22,): 2, (0xED, 0x43): 2, (0xED, 0x53): 2,
          (0xED, 0x63): 2, (0xED, 0x73): 2, (0xDD, 0x22): 2, (0xFD, 0x22): 2}


def stored(mem):
    """Adresy (od $4000), které program zapisuje instrukcí s pevnou adresou.
    Hledá se jen podle bajtů, ne podle toku programu, takže je to horní mez:
    instrukce nalezená uprostřed dat se počítá taky. Pro vysvětlení rozdílu
    to stačí (rozdíl na proměnné, kterou kód zapisuje), k důkazu ne."""
    out = set()
    for i in range(0x5B00, 0x10000 - 3):
        for op, n in STORES.items():
            if bytes(mem[i:i + len(op)]) == bytes(op):
                k = i + len(op)
                a = mem[k] | (mem[k + 1] << 8)
                for j in range(n):
                    if 0x4000 <= a + j < 0x10000:
                        out.add(a + j - 0x4000)
    return out


def spans(addrs):
    out, s, p = [], None, None
    for a in sorted(addrs):
        if s is None or a != p + 1:
            if s is not None:
                out.append((s, p))
            s = a
        p = a
    if s is not None:
        out.append((s, p))
    return out


def report(rest, a_img, b_img, label):
    unexplained = sorted(rest)
    print('  %5d nevysvetlenych' % len(unexplained))
    for s, p in spans(unexplained):
        vals = ' '.join('%02X>%02X' % (a_img[i], b_img[i]) for i in range(s, min(p, s + 3) + 1))
        print('    $%04X-$%04X %4d B  %s %s%s' % (s + 0x4000, p + 0x4000, p - s + 1, label,
                                                vals, ' …' if p - s >= 4 else ''))
    return len(unexplained)


def main():
    if not os.path.isfile(L.ENTRY_Z80):
        sys.exit('chybi build/entry.z80 - spust tools/mksnapshot.sh')
    if not os.path.isfile(playrzx.RZX):
        sys.exit('chybi sources/tape/bobbybearing.rzx - viz sources/tape/README.md')
    entry, game = L.ram(L.ENTRY_Z80), L.ram(L.Z80)
    checks = diffs = 0

    # 0. bez pulzů proti simulovanému nahrání
    L.skoolkit_path()
    from skoolkit.snapshot import Snapshot
    from skoolkit.simutils import PC, SP, IXh, IXl, I, IM, IFF
    mem, regs, used = L.memory_image()
    mine = mem[0x4000:]
    d = [i for i in range(len(entry)) if mine[i] != entry[i]]
    ovl = [i for i in d if i < 6912 and matchloading.cell(i) in matchloading.OVERLAY]
    rest = [i for i in d if i not in set(ovl)]
    print('bez pulzu / simulovane nahrani, RAM $4000-$FFFF: %d kontrol, %d rozdilu '
          '(+ %d B v bunkach zavadece na radku 23)' % (len(entry) - len(ovl), len(rest), len(ovl)))
    print('  z bloku 3 precteno %d z %d B, z bloku 4 %d z %d B' % (
        used[0], len(L.turbo_blocks()[0]['raw']), used[1], len(L.turbo_blocks()[1]['raw'])))
    for s_, p_ in spans(rest)[:10]:
        print('    $%04X-$%04X' % (s_ + 0x4000, p_ + 0x4000))
    snap = Snapshot.get(L.ENTRY_Z80)
    pairs = {'PC': (regs[PC], snap.pc), 'SP': (regs[SP], snap.sp),
             'IX': ((regs[IXh] << 8) | regs[IXl], snap.ix), 'I': (regs[I], snap.i),
             'IM': (regs[IM], snap.im), 'IFF1': (regs[IFF], snap.iff1)}
    bad = [k for k, (a, b) in pairs.items() if a != b]
    print('  registry: %d kontrol, %d rozdilu (%s)' % (len(pairs), len(bad), ', '.join(
        '%s=$%04X' % (k, b) for k, (a, b) in pairs.items())))
    checks += len(entry) - len(ovl) + len(pairs)
    diffs += len(rest) + len(bad)
    if len(used) != 2 or used[0] != len(L.turbo_blocks()[0]['raw']) or \
            used[1] != len(L.turbo_blocks()[1]['raw']):
        print('  ! zavadec neprecetl turbo bloky cele')
        diffs += 1
    print()

    runs = runs_written({'entry': (L.ENTRY_Z80, entry), 'z80': (L.Z80, game)})
    rzx, partie, frames = rzx_written()
    from_entry = set().union(*(runs[r[0]] for r in RUNS if r[1] == 'entry'))
    everything = set().union(*runs.values()) | partie
    store = stored(L.rom48() + entry)

    # 1. kazeta proti RZX (akceptace): RZX stojí v menu, takže rozdíl smí
    # být jen tam, kde hra píše
    diff = {i for i in range(len(entry)) if entry[i] != rzx[i]}
    print('kazeta / RZX (menu), RAM $4000-$FFFF: %d kontrol, %d se lisi' % (len(entry), len(diff)))
    rest = diff - from_entry
    print('  %5d zapisuje hra v behu z kazety' % (len(diff) - len(rest)))
    a = len(rest)
    rest -= partie
    print('  %5d zapisuje hra v nahravce cele partie (%d snimku)' % (a - len(rest), frames))
    a = len(rest)
    rest -= store
    print('  %5d jsou promenne, ktere kod zapisuje na pevnou adresu' % (a - len(rest)))
    checks += len(entry)
    diffs += report(rest, entry, rzx, 'kazeta>RZX')

    # 2. kazeta proti Z80 (konec hry)
    diff = {i for i in range(len(entry)) if entry[i] != game[i]}
    print('\nkazeta / Z80 (konec hry), RAM $4000-$FFFF: %d kontrol, %d se lisi'
          % (len(entry), len(diff)))
    rest = diff - set().union(*runs.values())
    print('  %5d zapisuje hra v behu (%d behu: %s)' % (
        len(diff) - len(rest), len(RUNS), ', '.join(r[0] for r in RUNS)))
    a = len(rest)
    rest -= partie
    print('  %5d zapisuje hra v nahravce cele partie' % (a - len(rest)))
    a = len(rest)
    rest -= store
    print('  %5d jsou promenne, ktere kod zapisuje na pevnou adresu' % (a - len(rest)))
    for lo, hi, why in ANALYZED:
        span = range(lo - 0x4000, hi - 0x4000 + 1)
        part = {i for i in rest if i in span}
        rest -= part
        print('  %5d rozbor $%04X-$%04X (v behu a partii zmeneno %d/%d B): %s' % (
            len(part), lo, hi, sum(1 for i in span if i in everything), len(span), why))
    own = {i for i in rest if entry[i] == rzx[i] and i not in partie}
    rest -= own
    print('  %5d z80 sam: kazeta = RZX, cela partie bajt nezmeni, Z80 ma jiny:' % len(own))
    for s, p in spans(own):
        print('    $%04X-$%04X %4d B  kazeta>Z80 %s' % (
            s + 0x4000, p + 0x4000, p - s + 1,
            ' '.join('%02X>%02X' % (entry[i], game[i]) for i in range(s, min(p, s + 3) + 1))))
    checks += len(entry)
    diffs += report(rest, entry, game, 'kazeta>Z80')

    print('\nCELKEM: %d kontrol, %d rozdilu' % (checks, diffs))
    return 1 if diffs else 0


if __name__ == '__main__':
    sys.exit(main())
