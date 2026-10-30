#!/usr/bin/env python3
"""Co je na kazetě Bobby Bearing.

    ./tools/tapinfo.py [--basic]

Vypíše bloky TZX s časováním a kontrolním součtem; s `--basic` i řádek
BASICu zavaděče (REM s textem a kódem Alkatrazu) a čitelné texty v něm.
Rozbor je v `sources/docs/tape_layout.md`.
"""
import argparse, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as L          # noqa: E402


def printable(data, minlen=8):
    """Úseky tisknutelného ASCII aspoň `minlen` znaků: (offset, text)."""
    out, s = [], None
    for i, c in enumerate(data + b'\0'):
        if 32 <= c < 127:
            if s is None:
                s = i
        else:
            if s is not None and i - s >= minlen:
                out.append((s, data[s:i].decode('ascii')))
            s = None
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--basic', action='store_true')
    args = ap.parse_args()
    raw = open(L.TAPE, 'rb').read(10)
    print('%s: TZX %d.%02d, %d B' % (os.path.basename(L.TAPE), raw[8], raw[9],
                                     os.path.getsize(L.TAPE)))
    for n, b in enumerate(L.tzx_all_blocks(), 1):
        if b['id'] == 0x32:
            print('%d: $32 archivni info %s' % (n, b['info']))
            continue
        line = '%d: $%02X  flag $%02X  %6d B  soucet %s  pauza %d ms' % (
            n, b['id'], b['flag'], len(b['raw']), 'OK' if b['ok'] else 'nesedi', b['pause'])
        if b['timing']:
            t = b['timing']
            line += '  pilot %d T x %d, sync %d/%d, bity %d/%d T' % (
                t['pilot'], t['pilotPulses'], t['sync1'], t['sync2'], t['zero'], t['one'])
        print(line)
        if b['header']:
            h = b['header']
            print('     %s: %r  delka %d  param1 %d  param2 %d' % (
                h['typeName'], h['name'], h['length'], h['param1'], h['param2']))
    if args.basic:
        prog = L.basic_block()
        num = (prog[0] << 8) | prog[1]
        length = prog[2] | (prog[3] << 8)
        print('\nBASIC na PROG $%04X: radek %d, delka %d B, prvni token $%02X%s'
              % (L.PROG, num, length, prog[4], ' (REM)' if prog[4] == 0xEA else ''))
        for off, text in printable(prog):
            print('  $%04X  %s' % (L.PROG + off, text))
    print('\npredani rizeni (tools/mksnapshot.sh): $F92A -> $%04X -> $%04X, SP $%04X'
          % (L.HANDOVER, L.ENTRY, L.ENTRY_SP))


if __name__ == '__main__':
    main()
