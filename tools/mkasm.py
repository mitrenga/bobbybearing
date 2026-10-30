#!/usr/bin/env python3
"""Disassembly Bobby Bearing: obraz paměti → SkoolKit `.ctl` → `.skool`.

    ./tools/mkasm.py                          # sources/asm/bobbybearing.skool z .ctl
    ./tools/mkasm.py --coverage               # sources/asm/coverage.map z běhů (≈ 4 min)
    ./tools/mkasm.py --ctl-from-map sources/asm/coverage.map [--force]

Vstupem je **jen** RAM na vstupu do hry `$D6B6` ze simulovaného nahrání
kazety (`build/entry.z80`, tools/mksnapshot.sh): program je tam už
dešifrovaný a posunutý stubem zavaděče na svá místa. Nikdy surový turbo
blok (`sources/docs/tape_layout.md`). Disassembly začíná na `$5B00`.

`--coverage` sestaví mapu provedených adres ze všech běhů
`matchimage.RUNS` (tools/playtrace.py) a z celé partie RZX
(tools/playrzx.py). `sources/asm/bobbybearing.ctl` je ručně udržovaný
podklad: první podobu vyrobí `--ctl-from-map` ze SkoolKit `sna2ctl.py`, co
je ručně, se dopisuje a **znovu se negeneruje** (bez `--force` to nástroj
odmítne). `bobbybearing.skool` se z `.ctl` dělá vždycky znovu.
"""
import argparse, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as L   # noqa: E402

ORG = 0x5B00
ASM = os.path.join(L.ROOT, 'sources', 'asm')
CTL = os.path.join(ASM, 'bobbybearing.ctl')
SKOOL = os.path.join(ASM, 'bobbybearing.skool')
COVERAGE = os.path.join(ASM, 'coverage.map')
BIN = os.path.join(L.BUILD, 'bobbybearing_code.bin')
SCRIPTS = os.path.join(L.SKOOLKIT, 'skoolkit-10.1.data', 'scripts')

# ★ doložené rutiny (sources/docs/disasm_notes.md); doplňují se ručně do .ctl
NAMES = {
    0x5B00: ('HANDOVER', 'Stub zavaděče: posun programu, smazání, SP, JP ENTRY'),
    0xD6B6: ('ENTRY', 'Vstup do hry ze stubu zavaděče (§1)'),
    0xD6D0: ('MENU', 'Smyčka menu po nahrání: 6/7 volba, 0 start (§1)'),
    0xD969: ('START', 'Start hry: čas, IM 2 s I=$FA, JP $74CC (§1)'),
    0x71AF: ('GAME_JUMPS', 'Tabulka skoků hry (§1)'),
    0x71BB: ('AFTER_GAME', 'Obrazovka po hře (§2a)'),
    0x73C0: ('PAUSE', 'Pauza SPACE, v pauze 1+4 konec hry (§4)'),
    0x73F5: ('PASS_END', 'Konec průchodu: konec času, pauza, odpočet (§4)'),
    0x7404: ('TIME_TICK', 'Odpočet času $FE66-$FE69, jednou za průchod (§2, §4)'),
    0x74F3: ('GAME', 'Začátek hry (z $74CC)'),
    0x751E: ('MAINLOOP', 'Hlavní smyčka, JP $751E na $7635; na snímek nečeká (§4)'),
    0x7648: ('LOOP_DELAY', 'Zpoždění: LDIR 1800 B samo na sebe, 2x/1x/0x podle ($C9A4) (§4)'),
    0x7D3D: ('END_DELAY', 'Čekání před $71AF u textu AND THEY ALL LIVED... (§1)'),
    0x81EA: ('CHEAT_Q', 'Klávesa Q = CHEAT (hw_notes.md)'),
    0xFB08: ('ISR', 'Obsluha IM 2 (vektor $FAFF/$FB00 přes sběrnici $FF) (§4)'),
    0xFB8C: ('SFX', 'Přehrávač zvukových efektů na beeper (§4)'),
    0xFC94: ('INPUT', 'Vstup podle ($FEE7): klávesnice, Kempston, Cursor, Sinclair'),
}


def run(script, *args, out=None):
    env = dict(os.environ, PYTHONPATH=L.SKOOLKIT)
    res = subprocess.run([sys.executable, os.path.join(SCRIPTS, script), *args],
                         env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                         check=True)
    if out:
        open(out, 'wb').write(res.stdout)
    return res.stdout


def coverage():
    """Provedené adresy ze všech běhů matchimage.RUNS a z celé partie RZX."""
    import playtrace
    import playrzx
    import matchimage as M
    addrs = set()
    images = {'entry': L.ENTRY_Z80, 'z80': L.Z80}
    for name, start, script, dumps in M.RUNS:
        path = os.path.join(L.BUILD, 'coverage', name + '.map')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        playtrace.run(images[start], max(dumps) + 1, os.path.dirname(path), path,
                      playtrace.parse_script(script), (), None)
        addrs |= {int(l[1:5], 16) for l in open(path) if l.startswith('$')}
    path = os.path.join(L.BUILD, 'coverage', 'rzx.map')
    playrzx.play(out=os.path.dirname(path), every=0, map_path=path)
    addrs |= {int(l[1:5], 16) for l in open(path) if l.startswith('$')}
    open(COVERAGE, 'w').write(''.join('$%04X\n' % a for a in sorted(addrs)))
    print('zapsano %s (%d adres, ROM %d)' % (
        COVERAGE, len(addrs), sum(1 for a in addrs if a < 0x4000)))


def ctl_from_map(path, force):
    if os.path.exists(CTL) and not force:
        raise SystemExit('%s uz existuje a je rucne udrzovany – --force ho prepise' % CTL)
    raw = run('sna2ctl.py', '-h', '-o', '0x%04X' % ORG, '-m', path, BIN).decode()
    head = ['; Bobby Bearing (The Edge 1986) – disassembly RAM $5B00-$FFFF na vstupu',
            '; do hry $D6B6 (build/entry.z80, tools/mksnapshot.sh). Prvni podoba z mapy',
            '; pokryti (tools/mkasm.py --ctl-from-map), dal rucne.']
    out, named = [], set()
    for l in raw.splitlines():
        if not l.strip():
            continue
        p = l.split()
        if len(p) >= 2 and p[0] in 'bcgistuw' and p[1].startswith('$'):
            a = int(p[1][1:], 16)
            if a in NAMES and a not in named:
                name, text = NAMES[a]
                out.append('@ $%04X label=%s' % (a, name))
                l = '%s $%04X %s' % (p[0], a, text)
                named.add(a)
        out.append(l)
    # jména uvnitř bloků: jen štítek
    for a in sorted(set(NAMES) - named):
        out.append('@ $%04X label=%s' % (a, NAMES[a][0]))
    open(CTL, 'w').write('\n'.join(head + out) + '\n')
    print('zapsano %s (%d radku)' % (CTL, len(head + out)))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--coverage', action='store_true')
    ap.add_argument('--ctl-from-map', metavar='MAP')
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    if not os.path.isfile(L.ENTRY_Z80):
        sys.exit('chybi build/entry.z80 - spust tools/mksnapshot.sh')
    os.makedirs(ASM, exist_ok=True)
    if args.coverage:
        coverage()
        return
    # obraz od ORG, aby sna2skool znal adresy (soubor .bin se čte od -o)
    open(BIN, 'wb').write(L.ram(L.ENTRY_Z80)[ORG - 0x4000:])
    if args.ctl_from_map:
        ctl_from_map(args.ctl_from_map, args.force)
    run('sna2skool.py', '-H', '-o', '0x%04X' % ORG, '-c', CTL, BIN, out=SKOOL)
    n = sum(1 for _ in open(SKOOL))
    print('zapsano %s (%d radku)' % (SKOOL, n))


if __name__ == '__main__':
    main()
