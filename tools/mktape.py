#!/usr/bin/env python3
"""Z kazety udělá scénář pro LOAD TAPE: `data/tape.json`.

    ./tools/mktape.py [data/tape.json]

Čtyři bloky v pořadí kazety (`sources/docs/tape_layout.md`) a u každého
**jak zní**: délka a počet pulzů pilotu, synchronizace, délky bitů a bajty,
které nese — tak, jak leží na pásce.

- **standardní bloky (ID $10)**: hlavička `BOBBY` a BASIC. V TZX nesou jen
  data; pilot, synchronizace a bity jsou ROM (`SA-BYTES`): pulz pilotu
  2168 T, 8063 pulzů před hlavičkou a 3223 před daty, synchronizace
  667/735 T, bity 855/1710 T
- ★ **turbo bloky (ID $11)** nesou časování samy: pilot 2143 / 2144 T,
  synchronizace 674/674 T, bity 561/1122 T. ★ Zavaděč Alkatraz skládá bajt
  od nejvyššího bitu, takže bajty jsou v paměti tak, jak leží na pásce;
  dešifruje je až kód (`bblib.memory_image()`)

★ Oba turbo bloky se hrají celé. Blok 4 má 46 583 B, přes tři minuty
pásky: kontrolu (2 B), obrázek (6714 B), proměnné a program — a po celou
dobu zavaděč kreslí běžící text a odpočítává počítadlo do nuly
(`data/overlay.json`, `tools/traceoverlay.py`). `eventBytes` říká, po
kterých bajtech posílá zvuk událost `tapeByte` (u bloku 4 po každém),
`pictureBytes`, které z nich jsou obrázek (pořadí adres v
`data/loading.json`).

? **Pauzy** mezi bloky jsou vlastnost obalu TZX, ne kazety; remake se o ně
opře jen řádově.
"""
import argparse, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bblib as L                                                # noqa: E402

ROM = {'pilot': 2168, 'sync': [667, 735], 'zero': 855, 'one': 1710}
ROM_PILOT_PULSES = {0x00: 8063, 0xFF: 3223}   # podle flagu: hlavička / data
PICTURE = [2, 6714]                           # ★ bajty obrázku v bloku 4
TURBO_CUT = {3: None, 4: None}                # oba bloky celé


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dst', nargs='?', default=os.path.join(L.ROOT, 'data', 'tape.json'))
    args = ap.parse_args()

    blocks = []
    for n, blk in enumerate(L.tzx_blocks(), 1):
        data = bytes(blk['raw'])
        out = {'block': n, 'flag': blk['flag'], 'length': len(data), 'pauseMs': blk['pause']}
        if blk['id'] == 0x10:
            if not blk['ok']:
                raise SystemExit('blok %d: nesedí součet XOR' % n)
            out.update({'kind': 'rom', 'pilot': ROM['pilot'],
                        'pilotPulses': ROM_PILOT_PULSES[blk['flag']],
                        'sync': ROM['sync'], 'zero': ROM['zero'], 'one': ROM['one']})
            out['bytes'] = data.hex()
        else:
            t = blk['timing']
            cut = TURBO_CUT[n]
            out.update({'kind': 'turbo', 'pilot': t['pilot'], 'pilotPulses': t['pilotPulses'],
                        'sync': [t['sync1'], t['sync2']], 'zero': t['zero'], 'one': t['one'],
                        'cut': cut is not None})
            if n == 4:
                out['pictureBytes'] = PICTURE
                out['eventBytes'] = [0, len(data)]
            out['bytes'] = (data if cut is None else data[:cut]).hex()
        if blk['header']:
            h = blk['header']
            out.update({'header': True, 'type': h['typeName'], 'name': h['name'],
                        'dataLength': h['length'], 'param1': h['param1']})

        def sounds(payload):
            ones = sum(bin(b).count('1') for b in payload)
            tstates = (out['pilot'] * out['pilotPulses'] + sum(out['sync'])
                       + 2 * (ones * out['one'] + (8 * len(payload) - ones) * out['zero']) + 945)
            return round(tstates / 3500)
        out['tapeMs'] = sounds(data)
        out['durationMs'] = sounds(bytes.fromhex(out['bytes']))
        blocks.append(out)

    result = {
        'note': 'Scénář pro LOAD TAPE z kazety (tools/mktape.py): bloky v pořadí '
                'kazety, časování a bajty, jak jdou po pásce (oba turbo bloky celé).',
        'source': os.path.basename(L.TAPE),
        'blocks': blocks,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.dst)), exist_ok=True)
    with open(args.dst, 'w') as f:
        json.dump(result, f, indent=1)
        f.write('\n')
    for b in blocks:
        print('%d  %-5s %-10s %6d B  pilot %4d×%d T  %6d ms na pásce, zahraje se %6d ms  pauza %d ms'
              % (b['block'], b['kind'], (b.get('name') or '').strip() or '-', b['length'],
                 b['pilotPulses'], b['pilot'], b['tapeMs'], b['durationMs'], b['pauseMs']))
    print('-> %s' % args.dst)


if __name__ == '__main__':
    main()
