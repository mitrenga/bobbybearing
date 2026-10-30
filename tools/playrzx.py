#!/usr/bin/env python3
"""Přehraje nahrávku RZX a po snímcích ukládá RAM a obrazovku.

    ./tools/playrzx.py [--every N] [--shots 100,5000,…] [--out DIR] [--map FILE]
                       [--watch $6812,…] [--loop $751E]

Nahrávka `sources/tape/bobbybearing.rzx` (RZX Archive, xmikex a Jamie Angus,
SPIN 0.5) je snapshot 128K v menu po nahrání a vstupy celé partie
(135 880 snímků, ≈ 45 min). Přehrává ji SkoolKit (`skoolkit.rzxplay`):
každý snímek proběhne přesně tolik instrukcí, kolik zaznamenal emulátor, a
čtení portů vrací zaznamenané hodnoty, takže stav po snímku je stav originálu.

Ukládá se RAM tak, jak ji vidí 48K hra (`$4000`–`$FFFF` = banky 5, 2 a 0;
stránkování zamkl stub zavaděče `OUT ($7FFD),$30`), každých `--every`
snímků (`ramNNNNNN.bin`), a obrazovky ve snímcích `--shots`
(`frameNNNNNN.png`). `--watch` hlídá adresy po každém snímku a vypíše každou
změnu hodnoty. `--loop` vypíše, ve kterých snímcích program prošel danou
adresou (začátek hlavní smyčky), a z toho tempo v průchodech za snímek.
"""
import argparse, os, sys, types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as L          # noqa: E402

L.skoolkit_path()
sys.path.insert(0, L.RETRO)
from scr2png import scr_to_rgb, write_png      # noqa: E402
from skoolkit import rzxplay                   # noqa: E402

RZX = os.path.join(L.ROOT, 'sources', 'tape', 'bobbybearing.rzx')


def ram48(memory):
    """RAM `$4000`–`$FFFF` 48K hry z paměti simulátoru (128K: banky 5, 2, 0)."""
    if len(memory) == 0x20000:
        # skoolkit Memory: .memory = [ROM, banka 5, banka 2, banka na $C000]
        return b''.join(bytes(m) for m in memory.memory[1:4])
    return bytes(memory[0x4000:0x10000])


class Recorder:
    """Místo okna SkoolKitu: `draw()` se volá po každém snímku."""

    def __init__(self, out, every, shots, context_ref, watch=(), loop=None):
        self.out, self.every, self.shots = out, every, set(shots)
        self.context_ref = context_ref
        self.saved = []
        self.watch = {a: None for a in watch}
        self.changes = []
        self.loop, self.passes = loop, []

    def draw(self, scr, frame, border):
        ctx = self.context_ref[0]
        if self.loop is not None:
            # mapa provedených adres za tenhle snímek (CSimulator ji plní
            # v exec_frame); začátek smyčky v ní = průchod začal v tomto snímku
            if self.loop in ctx.exec_map:
                self.passes.append(frame)
            ctx.exec_map.clear()
        for a, old in self.watch.items():
            v = ctx.simulator.memory[a]
            if v != old:
                self.changes.append((frame, a, old, v))
                self.watch[a] = v
        if self.every and frame % self.every == 0:
            ram = ram48(ctx.simulator.memory)
            path = os.path.join(self.out, 'ram%06d.bin' % frame)
            open(path, 'wb').write(ram)
            self.saved.append(path)
        if frame in self.shots:
            write_png(os.path.join(self.out, 'frame%06d.png' % frame),
                      scr_to_rgb(bytes(scr)), 256, 2)
        return True


def play(rzx=RZX, out=None, every=1000, shots=(), map_path=None, stop=0, watch=(),
         loop=None):
    out = out or os.path.join(L.BUILD, 'rzx')
    os.makedirs(out, exist_ok=True)
    ref = [None]
    rec = Recorder(out, every, shots, ref, watch, loop)
    rzxplay.get_screen = lambda *a: rec
    real_context = rzxplay.RZXContext

    def context(screen):
        ctx = real_context(screen)
        if loop is not None:
            ctx.exec_map = set()
        ref[0] = ctx
        return ctx
    rzxplay.RZXContext = context
    options = types.SimpleNamespace(
        cmio=False, flags='0', force=False, fps=0, map=map_path, screen=True,
        python=False, quiet=True, scale=1, snapshot=None, stop=stop, trace=None,
        dump=None)
    rzxplay.run(rzx, options)
    return rec, ref[0]


def out_dir(args):
    return args.out or os.path.join(L.BUILD, 'rzx')


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--every', type=int, default=1000)
    ap.add_argument('--shots', default='')
    ap.add_argument('--out')
    ap.add_argument('--map')
    ap.add_argument('--stop', type=int, default=0)
    ap.add_argument('--watch', default='')
    ap.add_argument('--loop')
    args = ap.parse_args()
    shots = [int(x) for x in args.shots.split(',') if x]
    watch = [int(x.lstrip('$'), 16) for x in args.watch.split(',') if x]
    loop = int(args.loop.lstrip('$'), 16) if args.loop else None
    rec, ctx = play(out=args.out, every=args.every, shots=shots,
                    map_path=args.map, stop=args.stop, watch=watch, loop=loop)
    print('prehrano %d snimku, ulozeno %d vypisu RAM do %s' % (
        ctx.frame_count, len(rec.saved),
        os.path.dirname(rec.saved[-1]) if rec.saved else '-'))
    if loop is not None and len(rec.passes) > 1:
        p = rec.passes
        gaps = [b - a for a, b in zip(p, p[1:])]
        print('$%04X: %d pruchodu ve snimcich %d-%d, prumer %.3f snimku na pruchod'
              % (loop, len(p), p[0], p[-1], (p[-1] - p[0]) / (len(p) - 1)))
        import collections
        print('  mezery (snimky): ' + ', '.join(
            '%d x%d' % kv for kv in sorted(collections.Counter(gaps).items())))
        open(os.path.join(out_dir(args), 'passes.txt'), 'w').write(
            '\n'.join(str(f) for f in p) + '\n')
    for frame, a, old, v in rec.changes:
        print('snimek %6d  $%04X: %s -> $%02X' % (
            frame, a, '--' if old is None else '$%02X' % old, v))


if __name__ == '__main__':
    main()
