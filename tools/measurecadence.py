#!/usr/bin/env python3
"""Tempo remaku proti tempu originálu: průměrný průchod hlavní smyčkou.

    ./tools/measurecadence.py

★ Hlavní smyčka originálu (`$751E`) na snímek nečeká: průchod trvá podle
práce, zpoždění `$7648` a zvuků 1,5–2,2 snímku (`sources/docs/disasm_notes.md`
§4). **Remake to nesimuluje** (rozhodnutí operátora 2026-10-29, jako Booty):
průchod jde konstantně po `PASS_MS` z `app/gameWorker.js`, pro začátek 40 ms.

Konstanta má být **průměrný průchod originálu v celé partii bez přechodů
mezi místnostmi**. Nástroj ho změří na nahrávce RZX (`tools/playrzx.py`,
snímky, ve kterých program prošel `$751E`; mezery delší než `LONG` snímků
jsou přechody mezi místnostmi a nepočítají se), přepočte na milisekundy
snímku nahrávky (128K, 70 908 T při 3,5469 MHz) a porovná s `PASS_MS`.
Vypíše odchylku; nástroj nekončí chybou, protože 40 ms je rozhodnutá
zaokrouhlená hodnota, ne měření.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as L          # noqa: E402
import playrzx             # noqa: E402

LOOP = 0x751E
LONG = 8                   # snímků: delší mezera je přechod mezi místnostmi
FRAME_T_128 = 70908
CLOCK_128 = 3546900


def worker_pass_ms():
    src = open(os.path.join(L.ROOT, 'app', 'gameWorker.js')).read()
    return float(re.search(r'^var PASS_MS = ([0-9.]+);', src, re.M).group(1))


def main():
    rec, ctx = playrzx.play(out=os.path.join(L.BUILD, 'cadence'), every=0, loop=LOOP)
    p = rec.passes
    gaps = [b - a for a, b in zip(p, p[1:])]
    play = [g for g in gaps if g <= LONG]
    frame_ms = 1000.0 * FRAME_T_128 / CLOCK_128
    mean = sum(play) / len(play)
    ms = mean * frame_ms
    remake = worker_pass_ms()
    print('RZX: %d snimku, %d pruchodu $%04X, %d bez prechodu (mezery do %d snimku)'
          % (ctx.frame_count, len(p), LOOP, len(play), LONG))
    print('original: %.3f snimku na pruchod = %.2f ms (snimek %.3f ms, 128K)' % (mean, ms, frame_ms))
    print('remake:   PASS_MS = %.2f ms, odchylka %+.1f %%' % (remake, 100.0 * (remake - ms) / ms))
    return 0


if __name__ == '__main__':
    sys.exit(main())
