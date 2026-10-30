#!/usr/bin/env python3
"""Společné čtení kazety a obrazu paměti Bobby Bearing.

Jedno místo, kde je napsané, co je na kazetě, odkud je druhý obraz programu
a kde v paměti co leží. Nástroje `dump*`, `trace*` a `match*` to berou odsud,
aby se ta znalost nemusela opakovat (a rozcházet).

Kazetu a zavaděč popisuje `sources/docs/tape_layout.md`, oba obrazy
`sources/docs/provenance.md`.

Čtení TZX je převzaté z `thunderbirds/tools/tblib.py`; je to druhý konzument
téhož kódu, takže je kandidát do `svision/tools/retro/` (R-008).
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAPE = os.path.join(ROOT, 'sources', 'tape', 'Bobby Bearing.tzx')
# ★ nezávislý dump (operátor 2026-10-29: není pořízený z TAPE), snapshot ze hry
Z80 = os.path.join(ROOT, 'sources', 'tape', 'Bobby_Bearing_1986_The_Edge_Software.z80')
BUILD = os.path.join(ROOT, 'build')
ENTRY_Z80 = os.path.join(BUILD, 'entry.z80')


def _skoolkit():
    """SkoolKit vendorovaný ve svision (R-008), přes symlink `app/svision`."""
    for base in (os.path.join(ROOT, 'app', 'svision'),
                 os.path.join(ROOT, '..', 'svision')):
        p = os.path.join(base, 'sources', 'skoolkit')
        if os.path.isdir(p):
            return os.path.normpath(p)
    raise FileNotFoundError('SkoolKit ve svision/sources/skoolkit neni '
                            '(stahne ho svision/tools/retro/fetchsources.py)')


SKOOLKIT = _skoolkit()
# the shared offline tools of svision (scr2png, pngread …)
RETRO = os.path.normpath(os.path.join(SKOOLKIT, '..', '..', 'tools', 'retro'))
TAP2SNA = os.path.join(SKOOLKIT, 'skoolkit-10.1.data', 'scripts', 'tap2sna.py')

# --- kazeta -----------------------------------------------------------------

TYPES = {0: 'Program', 1: 'Number array', 2: 'Character array', 3: 'Bytes'}

ARCHIVE_INFO = {0x00: 'title', 0x01: 'publisher', 0x02: 'author', 0x03: 'year',
                0x04: 'language', 0x05: 'type', 0x06: 'price',
                0x07: 'loader', 0x08: 'origin', 0xFF: 'comment'}


def tzx_all_blocks(path=TAPE):
    """TZX → seznam **všech** bloků, i těch bez dat (archivní info)."""
    raw = open(path, 'rb').read()
    if raw[:8] != b'ZXTape!\x1a':
        raise ValueError('%s neni TZX' % path)
    out, i = [], 10
    while i < len(raw):
        bid = raw[i]
        offset = i
        i += 1
        if bid == 0x32:
            length = raw[i] | (raw[i + 1] << 8)
            body = raw[i + 2:i + 2 + length]
            info, k = {}, 1
            for _ in range(body[0]):
                tid, n = body[k], body[k + 1]
                info[ARCHIVE_INFO.get(tid, '%02X' % tid)] = body[k + 2:k + 2 + n].decode('latin1')
                k += 2 + n
            out.append({'id': bid, 'offset': offset, 'info': info})
            i += 2 + length
            continue
        timing = None
        if bid == 0x10:
            pause = raw[i] | (raw[i + 1] << 8)
            length = raw[i + 2] | (raw[i + 3] << 8)
            i += 4
        elif bid == 0x11:
            h = raw[i:i + 18]
            w = lambda k: h[k] | (h[k + 1] << 8)   # noqa: E731
            timing = {'pilot': w(0), 'sync1': w(2), 'sync2': w(4), 'zero': w(6),
                      'one': w(8), 'pilotPulses': w(10), 'lastBits': h[12]}
            pause = w(13)
            length = h[15] | (h[16] << 8) | (h[17] << 16)
            i += 18
        else:
            # schválně spadne: blok, který se tiše přeskočí, je ztracený blok
            raise NotImplementedError('blok ID $%02X na offsetu %d' % (bid, offset))
        blk = raw[i:i + length]
        i += length
        acc = 0
        for b in blk[:-1]:
            acc ^= b
        flag, body = blk[0], blk[1:-1]
        header = None
        if bid == 0x10 and flag == 0 and len(body) == 17:
            header = {
                'type': body[0],
                'typeName': TYPES.get(body[0], str(body[0])),
                'name': body[1:11].decode('latin1'),
                'length': body[11] | (body[12] << 8),
                'param1': body[13] | (body[14] << 8),
                'param2': body[15] | (body[16] << 8),
            }
        out.append({'id': bid, 'offset': offset, 'flag': flag, 'data': body,
                    'raw': blk, 'checksum': blk[-1], 'ok': acc == blk[-1],
                    'header': header, 'pause': pause, 'timing': timing})
    return out


def tzx_blocks(path=TAPE):
    """Jen bloky s daty ($10, $11), v pořadí na kazetě."""
    return [b for b in tzx_all_blocks(path) if b['id'] in (0x10, 0x11)]


def basic_block(path=TAPE):
    """★ Program `BOBBY` tak, jak ho ROM nahraje na PROG: jediný řádek 0
    s REM a zavaděčem Alkatraz uvnitř (`sources/docs/tape_layout.md`)."""
    blocks = tzx_blocks(path)
    assert blocks[0]['header'] and blocks[0]['header']['type'] == 0, blocks[0]
    return blocks[1]['data']


def turbo_blocks(path=TAPE):
    """★ Dva turbo bloky Alkatrazu: 4868 B a 46 583 B (bez flagu a součtu
    tak, jak je zapisuje TZX; jestli mají flag a součet, je otázka rozboru)."""
    return [b for b in tzx_blocks(path) if b['id'] == 0x11]


PROG = 23755            # začátek programu v BASICu (bez mikrodrivu)

# ★ Předání řízení (simulované nahrání tap2sna, 2026-10-29): po konci pásky
# skončí zavaděč na `$F92A` skokem na `$5B00` (buffer tiskárny), odtud
# `$5B3B` skočí na `ENTRY`. Hra tam začíná s DI a IM 1, SP = `$619E`.
HANDOVER = 0x5B00
ENTRY = 0xD6B6
ENTRY_SP = 0x619E

# ★ `$CDE7`–`$E5E6` ($1800 B, velikost bitmapy obrazovky): na vstupu tam leží
# úvodní kód a menu (`ENTRY`, smyčka kláves `$D6D0`), ve snapshotu ze hry
# (`Z80`) samé `$FF`. ? Buffer, kterým hra úvodní kód přepíše.
INIT_AREA = (0xCDE7, 0xE5E7)


# --- obraz paměti bez pulzů ---------------------------------------------------
#
# ★ Zavaděč Alkatraz (sources/docs/tape_layout.md) běží od `USR $5D4C`: desítky
# dešifrovacích vrstev (XOR, rotace, od `$EF06` i registr R), pak dva stupně
# čtení pásky. Oba skládají bajt stejně: `LD L,$01`, dvě hrany na bit, `RL L`,
# dokud nevypadne jednička — bajt je tedy bajt TZX, jak leží (od nejvyššího
# bitu). Dešifrování za letu (XOR s D, E, IX, L a průběžným klíčem) dělá kód
# zavaděče sám.
#
# memory_image() **nepouští pásku pulz po pulzu**: kód zavaděče nechá běžet na
# CPU SkoolKitu, ale hledání pilotu přeskočí (`SKIPS`) a smyčku bajtu nahradí
# dalším bajtem turbo bloku (`READS`). Výchozí stav je snapshot na USR
# (build/atusr.z80): hlavičku a BASIC nahrála ROM standardně. Přeskočí se tím
# i kreslení zavaděče během nahrávání (běžící text a počítadlo v řádku 23,
# které obstarává rutina hran `$F7AE`) — jinak je obraz shodný se simulovaným
# nahráním (tools/matchimage.py). R nevadí: vrstvy s `LD A,R` běží až po
# `LD R,A` na `$EF06` a `LD A,R` na `$F70E` se hned přepíše.

ATUSR_Z80 = os.path.join(BUILD, 'atusr.z80')
USR = 0x5D4C
# začátek hledání pilotu -> první instrukce po synchronizaci
SKIPS = {0xECFC: 0xED3B, 0xF6DA: 0xF702}
# začátek smyčky bajtu -> (turbo blok, první instrukce po ní)
READS = {0xED4F: (0, 0xED62), 0xF712: (1, 0xF725)}


def memory_image(atusr=None, path=TAPE):
    """64K paměti ve chvíli, kdy stub skočí na `ENTRY`, složené bez pulzů.
    Vrací (bytes 64K, registry SkoolKitu, [přečteno z bloku 3, z bloku 4])."""
    skoolkit_path()
    from skoolkit.snapshot import Snapshot
    from skoolkit.simulator import Simulator
    from skoolkit.simutils import from_snapshot, PC, F, L
    snap = Snapshot.get(atusr or ATUSR_Z80)
    if snap.pc != USR:
        raise ValueError('snapshot neni na USR $%04X' % USR)
    sim = from_snapshot(Simulator, snap)
    r, mem = sim.registers, sim.memory
    streams = [b['raw'] for b in turbo_blocks(path)]
    used = [0] * len(streams)
    steps = 0
    while r[PC] != ENTRY:
        pc = r[PC]
        if pc in SKIPS:
            r[PC] = SKIPS[pc]
            continue
        if pc in READS:
            k, ret = READS[pc]
            r[L] = streams[k][used[k]]
            used[k] += 1
            r[F] |= 1          # CY: bajt je celý (RL L vysunulo zarážku)
            r[PC] = ret
            continue
        sim.run()
        steps += 1
        if steps > 50_000_000:
            raise RuntimeError('zavadec se nedostal na $%04X (PC $%04X)' % (ENTRY, r[PC]))
    return bytes(mem[0:0x10000]), r, used


def peek(mem, addr, n=1):
    return mem[addr - 0x4000:addr - 0x4000 + n]


def word(mem, addr):
    b = peek(mem, addr, 2)
    return b[0] | (b[1] << 8)


def rom48():
    return open(os.path.join(SKOOLKIT, 'skoolkit', 'resources', '48.rom'), 'rb').read()


def skoolkit_path():
    import sys
    if SKOOLKIT not in sys.path:
        sys.path.insert(0, SKOOLKIT)


def ram(path):
    """RAM `$4000`–`$FFFF` snapshotu jako bytes (48 KB)."""
    skoolkit_path()
    from skoolkit.snapshot import Snapshot
    return bytes(Snapshot.get(path).ram(-1))


def memory64(path):
    """64K: ROM 48K + RAM snapshotu."""
    return rom48() + ram(path)


# --- disassembly ------------------------------------------------------------

def disassemble(mem, start, end):
    """Řádky `ADDR  bajty  instrukce` z 64K obrazu `mem` (SkoolKit)."""
    import types
    skoolkit_path()
    from skoolkit.disassembler import Disassembler

    class Instr:
        def __init__(self, address, operation, data):
            self.address, self.operation, self.bytes = address, operation, data
            self.variant = 0

    cfg = types.SimpleNamespace(asm_hex=True, asm_lower=False, defb_size=8,
                                defm_size=66, defw_size=1, handle_rst=False,
                                imaker=Instr, opcodes='', wrap=False)
    out = []
    for i in Disassembler(list(mem), cfg).disassemble(start, end, 'h'):
        out.append('$%04X  %-12s %s' % (i.address, bytes(i.bytes).hex(), i.operation))
    return out
