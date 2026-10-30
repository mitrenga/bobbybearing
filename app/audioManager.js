const { AbstractAudioManager } = await import('./svision/js/audio/abstractAudioManager.js?ver='+window.srcVersion);
const { AudioWorkletHandler } = await import('./svision/js/audio/audioWorkletHandler.js?ver='+window.srcVersion);
const { AudioScriptProcessorHandler } = await import('./svision/js/audio/audioScriptProcessorHandler.js?ver='+window.srcVersion);
const { AudioSilentHandler } = await import('./svision/js/audio/audioSilentHandler.js?ver='+window.srcVersion);
const { Tool } = await import('./svision/js/tool.js?ver='+window.srcVersion);
const { ZXMachineSounds } = await import('./svision/js/platform/canvas2D/zx/zxMachineSounds.js?ver='+window.srcVersion);
// begin code

/**
 * Audio manager. The original has a one-bit beeper on bit 4 of port $FE and no
 * sound chip, so every sound is a stream of pulse lengths played by the svision
 * pulse handlers — the same way the machine makes sound, not sampled.
 *
 * ★ The game's sounds are effects played by the interrupt handler ($FB08 →
 * `$FB8C`: two request slots, three channels played one after another in
 * the same handler — disasm_notes.md §4, physics.md §13). **The remake
 * plays each kind of sound on a bus of its own** (operator 2026-10-30,
 * `BUSES`): a room change and Q CHEAT on `game` (never two at once), the
 * ball's bumps on `ball`, the brothers on `brothers`, the lifts, crushers,
 * vents and appearing blocks on `blocks`, the bad Bearings on `bearings` —
 * so a sound does not cut off another, as it would on one bus; where the
 * original interleaves two channels in one handler, the remake plays both
 * whole, side by side. One slider (`sounds`) sets them all.
 *
 * The machine's own sounds: the key click of the ROM (svision
 * ZXMachineSounds) and the four blocks of the tape as data/tape.json has
 * them — each with its own pilot, sync pulses and bits (★ the two turbo
 * blocks in the Alkatraz loader's timing: pilot 2143 / 2144 T, sync
 * 674/674 T, bits 561/1122 T) and the bytes they really carry.
 *
 * ★ **The game's sound** (M6, M7): the worker runs the original's handler
 * over the game's memory once a frame of the machine (app/beeperPlayer.js,
 * checked edge for edge by tools/matchsound.mjs), and for every request it
 * takes it sends **the whole effect rendered** (gameWorker.js renderEffect)
 * in `sounds`; `playFrame` starts it with one `playSound`, the way Manic
 * Miner starts its prepared sounds, and the worklet plays it on its own —
 * neither the worker nor the drawing loop has a hand in its timing.
 */
export class AudioManager extends AbstractAudioManager {

  /** ★ T-states of a frame of the 48K and the Z80 clock. */
  static get FRAME_T() { return 69888; }
  static get CLOCK() { return 3500000; }
  /** The buses of the game's sounds, one a kind (BobbyLogic.soundRequest). */
  static get BUSES() { return ['game', 'ball', 'brothers', 'blocks', 'bearings']; }

  constructor(app) {
    super(app);
    this.id = 'AudioManager';
    this.volume = {};
    this.volume.sounds = Math.min(10, Math.max(0, Math.round(Number(Tool.readCookie('audioBusSoundsLevel', 5)))));
  } // constructor

  /**
   * Reads a data file delivered with appData; see {@link Tool.loadDataFile}.
   * @param {string} key - The data file name without its extension.
   * @returns {Object|null} The parsed content, or null.
   */
  loadDataFile(key) {
    return Tool.loadDataFile(key);
  } // loadDataFile

  /**
   * One block of the tape as it sounds: the pilot, the two sync pulses, every
   * bit of the bytes the block carries and the terminating pulse — in the
   * block's own timing out of data/tape.json (tools/mktape.py), played by
   * svision's ZXMachineSounds.tapeBlock.
   *
   * Three events come with it, and the tape loading lives off them rather
   * than off a timer, so the picture and the stripes cannot drift away from
   * the sound:
   *
   * - `tapePilotEnd` when the pilot is over — the stripes change,
   * - `tapeByte` after every byte of `eventBytes` (first byte and count;
   *   all of the second turbo block), with its number in the block (`at`)
   *   and its value **as it goes down the tape** — encrypted;
   *   tapeLoadingModel takes what the loader does with it from
   *   data/loading.json and data/overlay.json,
   * - `tapeBlockEnd` when the block is over — the tape moves on.
   *
   * Nothing is sped up: the second turbo block takes its three minutes, the
   * picture the first 28 seconds of them, as on the machine.
   *
   * @param {number} sampleRate - The audio context sample rate.
   * @param {number} level - Bus volume level.
   * @param {number} number - The block, 1-4 in the order of the tape.
   * @returns {Object|boolean} svision pulse data, or false with no data file.
   */
  tapeBlockSound(sampleRate, level, number) {
    var tape = this.loadDataFile('tape');
    if (!tape || !tape.blocks || !tape.blocks[number-1]) {
      return false;
    }
    var block = tape.blocks[number-1];
    var bytes = ZXMachineSounds.dataBytes(block.bytes);
    var options = {pilotEndEvent: 'tapePilotEnd', endEvent: 'tapeBlockEnd',
                   eventData: {block: number}};
    // the bytes that send `tapeByte`: first byte and count (data/tape.json
    // eventBytes — every byte of the second turbo block, because the loader
    // draws on the screen all the way through it)
    var events = block.eventBytes || block.pictureBytes;
    if (events) {
      Object.assign(options, {byteEvent: 'tapeByte', firstEventByte: events[0],
                              lastEventByte: events[0]+events[1]-1});
    }
    return ZXMachineSounds.tapeBlock(sampleRate, level, block, bytes, options);
  } // tapeBlockSound

  createAudioHandler(bus, options) {
    var audioHandler = false;

    // every bus of the game and the machine's own `sounds` go by the one
    // slider
    var volume = this.volumeLevel(this.volume.sounds);

    if (options.audioSilentHandler != 'disable' && volume == 0.0) {
      return new AudioSilentHandler(this.app);
    }

    if (this.unsupportedAudioBus == false) {
      this.unsupportedAudioBus = Tool.readCookie('unsupportedAudioBus', false);
    }

    switch (this.unsupportedAudioBus) {
      case false:
        audioHandler = new AudioWorkletHandler(this.app);
        break;
      case 'AudioWorkletHandler':
        Tool.writeCookie('unsupportedAudioBus', 'AudioWorkletHandler');
        audioHandler = new AudioScriptProcessorHandler(this.app);
        break;
      case 'AudioScriptProcessorHandler':
        Tool.writeCookie('unsupportedAudioBus', 'AudioScriptProcessorHandler');
        audioHandler = new AudioSilentHandler(this.app);
        break;
    }

    if (bus in this.restartSounds) {
      this.app.model.sendEvent(1, {id: 'playSound', bus: bus, sound: this.restartSounds[bus].sound, options: this.restartSounds[bus].options});
    }

    return audioHandler;
  } // createAudioHandler

  audioData(bus, sound, options) {
    var data = super.audioData(bus, sound, options);
    if (data !== false) {
      return data;
    }

    var sampleRate = this.getSampleRate();
    var level = this.volumeLevel(this.volume.sounds);
    var tapeBlock = /^tapeBlock(\d+)$/.exec(sound);
    if (tapeBlock) {
      return this.tapeBlockSound(sampleRate, level, Number(tapeBlock[1]));
    }
    switch (sound) {
      case 'keyboardSound': return ZXMachineSounds.keyClick(sampleRate, level);
    }
    // ★ the game's sound: one request rendered whole by the worker
    // (gameWorker.js renderEffect), its edges in `options.outs`; kept by bus
    // and value, so the next request of the same value is a lookup (the
    // cache goes with the bus, so a new game renders at the slider's level)
    if (/^effect\d+$/.test(sound) && options && options.outs) {
      if (!(bus in this.audioDataCache)) {
        this.audioDataCache[bus] = {};
      }
      this.audioDataCache[bus][sound] = AudioManager.interruptSound(options.outs, sampleRate, level, options.length);
      return this.audioDataCache[bus][sound];
    }
    return false;
  } // audioData


  volumeLevel(volume) {
    var levels = [0, 0.005, 0.01, 0.02, 0.04, 0.07, 0.1, 0.14, 0.18, 0.23, 0.29];
    return levels[volume];
  } // volumeLevel

  /**
   * One worker frame: the requests the game's handler took in it, each a
   * whole effect, started on its bus with one message (WORKER-PROTOCOL.md).
   * @param {Object} frame - The 'frame' message from the worker.
   */
  playFrame(frame) {
    var model = this.app.model;
    if (!model) {
      return;
    }
    (frame.sounds || []).forEach((event) => {
      if (event.id !== 'effect' || !event.outs.length || !(event.bus in this.buses)) {
        return;
      }
      model.sendEvent(0, {id: 'playSound', bus: event.bus, sound: 'effect'+event.value,
                          options: {outs: event.outs, length: event.length}});
    });
  } // playFrame

  /**
   * ★ The edges of one effect (bit 4 of port $FE, T from its start) as
   * svision pulse data: pulse lengths in samples and their sequence, from
   * the first edge; padded with silence to `fill` T (whole frames of the
   * machine, as the handler left them).
   * @param {Array} outs - [[T, bit], …].
   * @param {number} sampleRate
   * @param {number} level - Bus volume.
   * @param {number} fill - Pad to this length in T.
   * @returns {Object} svision pulse data.
   */
  static interruptSound(outs, sampleRate, level, fill) {
    var k = sampleRate/AudioManager.CLOCK;
    var state = 1;                          // bit 4 high is the rest between pulses
    var last = 0;
    var lengths = [];
    for (var i = 0; i < outs.length; i++) {
      if (outs[i][1] === state) {
        continue;
      }
      state = outs[i][1];
      var at = Math.round(outs[i][0]*k);
      lengths.push(at-last);
      last = at;
    }
    lengths.push(Math.max(0, Math.round(fill*k)-last));
    if (lengths.length % 2) {
      lengths.push(0);
    }
    var fragments = [], keys = {};
    var pulses = new Uint16Array(lengths.length);
    for (var j = 0; j < lengths.length; j++) {
      if (!(lengths[j] in keys)) {
        keys[lengths[j]] = fragments.length;
        fragments.push(lengths[j]);
      }
      pulses[j] = keys[lengths[j]];
    }
    return {fragments: fragments, pulses: pulses, volume: level};
  } // interruptSound

} // AudioManager
