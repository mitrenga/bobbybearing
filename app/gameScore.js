// begin code

/**
 * The remake's score (M7, operator 2026-10-30). ★ The original keeps no
 * score and no table of names; its panel shows the time, the brothers and a
 * name. What the hall of fame ranks is three numbers the worker reads off
 * the original's memory after every pass (gameWorker.js score()), none of
 * them written back into it:
 *
 * - `brothers` — brought home, 0-5, ranked down;
 * - `rooms` — the rooms Bobby has been in, each once, without the starting
 *   one, ranked down;
 * - `time` — the game's time gone by at the moment of the last progress
 *   (a new room or a brother home), ranked up: the remake's own count of
 *   the ticks of the original's clock (`BobbyLogic.timeTicks`), eight to a
 *   unit of the panel's last digit, so the screens show `time / 8`
 *   rounded, five digits (a game can outrun the panel's four). `Q` CHEAT and the penalties cost ticks
 *   on purpose; the 1000 a brother home gives the clock back is no tick.
 *
 * A game that got nowhere (no room, no brother) is shown but not stored
 * (R-049). This is a module of its own so that the pause and the end screen
 * can use it without importing gameApp.js back.
 */
export class GameScore {

  /** @returns {Object} {brothers, rooms, time} at the start of a game. */
  static empty() {
    return {brothers: 0, rooms: 0, time: 0};
  } // empty

  /**
   * @param {Object} score - {brothers, rooms, time}
   * @returns {boolean} True for a game that got nowhere (not stored, R-049).
   */
  static isZero(score) {
    return !score || (!score.brothers && !score.rooms);
  } // isZero

  /**
   * Brothers and rooms in one line, the way the pause prints them:
   * `BROTHERS 2  ROOMS 37`. The time is left out there on purpose
   * (operator 2026-10-30): the panel's clock is on the screen under the
   * pause, and the time of the last progress next to it would read as a
   * second clock.
   * @param {Object} score - {brothers, rooms, time}
   * @returns {string}
   */
  static text(score) {
    var s = score || GameScore.empty();
    return 'BROTHERS '+s.brothers+'  ROOMS '+s.rooms;
  } // text

  /**
   * @param {Object} score - {brothers, rooms, time}
   * @returns {string} The time in the units of the panel's clock (eight
   *   ticks each, rounded), five digits: a game can run past 9999 units,
   *   since a brother home gives the clock time back.
   */
  static time(score) {
    return String(Math.round((score && score.time || 0)/8)).padStart(5, '0');
  } // time

} // GameScore

