#!/usr/bin/env python3
"""Loading screen z kazety proti archivnímu `.scr` a proti snapshotu ze hry.

    ./tools/mksnapshot.sh && ./tools/matchloading.py

Obrazovka po nahrání kazety (build/endtape.z80, simulované nahrání pulz po
pulzu) a na vstupu do hry (build/entry.z80) proti dvěma nezávislým obrazům:

- `sources/media/screens/BobbyBearing.scr` (ZXDB, loading screen)
- obrazovka snapshotu ze hry (`bblib.Z80`)

★ Zavaděč Alkatraz kreslí do obrázku vlastní věci: běžící text na řádku 23
(sloupce 1–21, „FROM THE EDGE ......“) a počítadlo na řádcích 22–23 ve
sloupcích 28–31 („000“). Ty buňky (`OVERLAY`) se kontrolují zvlášť: archiv
ani snapshot je nemají. ? Archivní `.scr` i snapshot pochází z nahrání bez
Alkatrazu (odjištěná TAP?) — `sources/docs/provenance.md`.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as L          # noqa: E402

SCR = os.path.join(L.ROOT, 'sources', 'media', 'screens', 'BobbyBearing.scr')

# znakové buňky (řádek, sloupec), do kterých kreslí zavaděč
OVERLAY = {(23, c) for c in range(1, 22)} | {(r, c) for r in (22, 23) for c in range(28, 32)}


def cell(i):
    """Znaková buňka bajtu obrazovky (bitmapa i atributy)."""
    if i >= 6144:
        return divmod(i - 6144, 32)
    y = ((i >> 11) & 3) * 64 + ((i >> 5) & 7) * 8 + ((i >> 8) & 7)
    return y // 8, i & 31


def compare(name, a, b):
    pic = [i for i in range(6912) if cell(i) not in OVERLAY]
    ovl = [i for i in range(6912) if cell(i) in OVERLAY]
    dp = [i for i in pic if a[i] != b[i]]
    do = [i for i in ovl if a[i] != b[i]]
    print('%-34s obrazek %5d kontrol, %d rozdilu;  buňky zavadece %d B, lisi se %d'
          % (name, len(pic), len(dp), len(ovl), len(do)))
    for i in dp[:10]:
        print('  $%04X (radek %d, sloupec %d): $%02X / $%02X' % ((0x4000 + i,) + cell(i) + (a[i], b[i])))
    return len(pic), len(dp)


def main():
    for f in ('entry.z80', 'endtape.z80'):
        if not os.path.isfile(os.path.join(L.BUILD, f)):
            sys.exit('chybi build/%s - spust tools/mksnapshot.sh' % f)
    scr = open(SCR, 'rb').read()
    game = L.ram(L.Z80)[:6912]
    end = L.ram(os.path.join(L.BUILD, 'endtape.z80'))[:6912]
    entry = L.ram(L.ENTRY_Z80)[:6912]
    checks = diffs = 0
    for name, a, b in (('konec pasky / archivni .scr', end, scr),
                       ('vstup do hry / archivni .scr', entry, scr),
                       ('vstup do hry / snapshot ze hry', entry, game),
                       ('archivni .scr / snapshot ze hry', scr, game)):
        n, d = compare(name, a, b)
        checks += n
        diffs += d
    full = sum(1 for i in range(6912) if scr[i] != game[i])
    print('archivni .scr / snapshot ze hry, cela obrazovka: %d rozdilu' % full)
    checks += 6912
    diffs += full
    print('\nCELKEM: %d kontrol, %d rozdilu' % (checks, diffs))
    return 1 if diffs else 0


if __name__ == '__main__':
    sys.exit(main())
