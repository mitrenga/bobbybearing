const { FramedPanelEntity } = await import('./framedPanelEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { SlidingTextEntity } = await import('./svision/js/platform/canvas2D/slidingTextEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { GameScore } = await import('./gameScore.js?ver='+window.srcVersion);
// begin code

/**
 * HALL OF FAME as a modal panel over the menu, where its dialogs open
 * (menuModel.js) — the menu keeps turning under it, as under SETTINGS. Silent,
 * like the menu.
 *
 * ★ **The original has no hall of fame and no score**: its panel shows the
 * time, the brothers and a name (sources/docs/screen_layout.md). This table
 * is **the remake's**: ten places, 1st to 10th, off the server, ranked by
 * the three numbers of gameScore.js (M7, operator 2026-10-30): brothers
 * home down, rooms seen down, the game's time at the last progress up.
 *
 * A row is place, the three numbers and the name, and a name too long for
 * its column ping-pongs (SlidingTextEntity), the way the player's name does
 * in the menu; the menu ticks the panel (loopEntity).
 *
 * CLOSE (Enter, Escape, space, GamepadOK, GamepadExit) closes the panel.
 *
 * The window is the remake's framed panel (framedPanelEntity.js), the same
 * as ABOUT GAME's, with the heading on its frame.
 */
export class HallOfFameEntity extends FramedPanelEntity {

  constructor(parentEntity, x, y, width, height) {
    super(parentEntity, x, y, width, height);
    this.id = 'HallOfFameEntity';

    this.rowEntities = [];
    // the names, ticked from loopEntity(): a name too long for its column ping-pongs
    this.nameEntities = [];

    // ? the remake's places, as in the sibling remakes
    // the suffix in lower case (operator 2026-10-31)
    this.places = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
  } // constructor

  init() {
    super.init();

    // on the panel: the CLOSE button and the ten places drawn by showTable();
    // the heading on the frame, plain text — the text is the remake's, see above
    var x = this.innerX, y = this.innerY, w = this.innerWidth, h = this.innerHeight;
    this.addEntity(new ButtonEntity(this, this.app.fonts.fonts5x5, x+w-39, y+h-16, 36, 13, 'CLOSE', {id: 'closeHallOfFame'}, ['Enter', 'Escape', ' ', 'GamepadOK', 'GamepadExit'], ZXColor.brightWhite, ZXColor.blue, {align: 'center', margin: 4, cornerMask: FramedPanelEntity.BUTTON_CORNER}));
    this.addTitle('HALL OF FAME');

    if (navigator.onLine) {
      this.fetchData('hallOfFame.db', false, {});
    } else {
      this.showTable(this.defaultTable(), true);
    }
  } // init

  /**
   * ? The original's own table, if it turns out to have one — it would come
   * out of data/global.json (M2/M4). Until then this is empty on purpose:
   * an invented set of names and scores presented as the game's would be
   * exactly the kind of thing this project does not do.
   * @returns {Array} [{name, brothers, rooms, time}], empty while the question is open.
   */
  defaultTable() {
    var global = this.app.globalData;
    if (global && global.hallOfFame && global.hallOfFame.defaults) {
      return global.hallOfFame.defaults;
    }
    return [];
  } // defaultTable

  setData(data) {
    var rows = Object.keys(data.data).map((key) => data.data[key]);
    if (!rows.length) {
      // nobody has played yet: show the table the original ships with
      this.showTable(this.defaultTable(), true);
      return;
    }
    this.showTable(rows, false);
  } // setData

  errorData(error) {
    this.showTable(this.defaultTable(), true);
  } // errorData

  /**
   * Draws the ten places.
   * @param {Array} rows - [{name, brothers, rooms, time}] in the order of
   *   the hall of fame (db/hallOfFame.php).
   * @param {boolean} original - True when these are the original's own entries.
   */
  showTable(rows, original) {
    this.rowEntities.forEach((entity) => entity.destroy());
    this.rowEntities = [];
    this.nameEntities = [];
    var x = this.innerX, y0 = this.innerY, w = this.innerWidth, h = this.innerHeight;
    // the first six in pairs, from the top down in the colours of the panel:
    // bright white, yellow, cyan; 7TH to 10TH white — on black
    var colors = [ZXColor.brightWhite, ZXColor.brightWhite, ZXColor.brightYellow, ZXColor.brightYellow, ZXColor.brightCyan, ZXColor.brightCyan,
                  ZXColor.white, ZXColor.white, ZXColor.white, ZXColor.white];
    // the columns under their headings: the place (flush right in the width of
    // the widest one), the name flush left, then flush right the brothers home (one digit), the rooms seen (up to
    // three) and the time (five); each figure column as wide as its heading or
    // its widest figure, GAP apart, the name takes what is left, and the whole
    // row MARGIN off the panel on both sides (the glyphs are cut to their
    // pixels, the place's at the left edge). Every row is in the 4 x 6 font
    // (operator 2026-10-31)
    var MARGIN = 4, GAP = 6;
    var font = this.app.fonts.fonts4x6;
    var measure = (font, text) => new TextEntity(this, font, 0, 0, 0, 0, '', false, false, {}).lineWidth(text);
    var head = (text) => measure(this.app.fonts.fonts5x5, text);
    var placeWidth = Math.max(...this.places.map((place) => measure(font, place)));
    // n figures as wide as the widest digit makes them
    var digitWidth = Math.max(...'0123456789'.split('').map((digit) => measure(font, digit)));
    var figuresWidth = (n) => n*digitWidth+(n-1)*font.charsSpacing;
    // ROOMS one space of the headings' font before TIME, as `ROOMS TIME`
    // would be printed (operator 2026-10-31), measured from the column of
    // TIME's five figures; all the figures and their headings flush right
    var space = head('ROOMS TIME')-head('ROOMS')-head('TIME');
    var columns = [{head: 'BROTHERS', figures: 1, gap: GAP, get: (r) => String(r.brothers)},
                   {head: 'ROOMS', figures: 3, gap: space, get: (r) => String(r.rooms)},
                   {head: 'TIME', figures: 5, gap: GAP, get: (r) => GameScore.time(r)}];
    var right = w-MARGIN;
    for (var c = columns.length-1; c >= 0; c--) {
      columns[c].width = Math.max(head(columns[c].head), figuresWidth(columns[c].figures));
      columns[c].x = right-columns[c].width;
      right = columns[c].x-(c > 0 ? columns[c-1].gap : GAP);
    }
    // the name may run on under the heading BROTHERS, up to GAP before its
    // one figure (operator 2026-10-31)
    var brothers = columns[0];
    var nameX = MARGIN+placeWidth+GAP, nameWidth = brothers.x+brothers.width-figuresWidth(brothers.figures)-GAP-nameX;
    this.addHeading('NAME', x+nameX, y0+3, right-nameX, 'left');
    columns.forEach((column) => this.addHeading(column.head, x+column.x, y0+3, column.width, 'right'));
    for (var i = 0; i < this.places.length; i++) {
      // 3 px under the frame and under the headings (5 rows), and the rows
      // 9 px apart: 4 px between the capitals (rows 0-4 of the 6 of the cell;
      // the sixth is the descenders')
      var y = y0+11+i*9;
      var row = rows[i];
      var color = colors[i];
      var place = new TextEntity(this, font, x+MARGIN, y, placeWidth, 6, this.places[i], color, false, {align: 'right'});
      this.addEntity(place);
      this.rowEntities.push(place);
      var name = new SlidingTextEntity(this, font, x+nameX, y, nameWidth, 6, row ? String(row.name) : '', color, false, {align: 'left', animation: 'pingPong', speed: 30});
      this.addEntity(name);
      this.rowEntities.push(name);
      this.nameEntities.push(name);
      columns.forEach((column) => {
        var cell = new TextEntity(this, font, x+column.x, y, column.width, 6, row ? column.get(row) : '', color, false, {align: 'right'});
        this.addEntity(cell);
        this.rowEntities.push(cell);
      });
    }
    if (original) {
      var note = new TextEntity(this, this.app.fonts.fonts5x5, x+4, y0+h-16, w-48, 12,
        navigator.onLine ? 'NOBODY HAS PLAYED YET' : 'SYSTEM OFFLINE',
        ZXColor.brightRed, false, {textWrap: true, margin: 1});
      this.addEntity(note);
      this.rowEntities.push(note);
    }
  } // showTable

  /**
   * A heading of a column of the table, in the 5 x 5 font, bright red.
   * @param {string} text - The heading.
   * @param {number} x - Its left edge.
   * @param {number} y - Its top.
   * @param {number} width - The width of the column.
   * @param {string} align - 'left' or 'right', as the column's figures.
   */
  addHeading(text, x, y, width, align) {
    var heading = new TextEntity(this, this.app.fonts.fonts5x5, x, y, width, 5, text, ZXColor.brightRed, false, {align: align});
    this.addEntity(heading);
    this.rowEntities.push(heading);
  } // addHeading

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'closeHallOfFame':
        this.destroy();
        return true;
    }

    return false;
  } // handleEvent

  /**
   * Entities are not ticked on their own: the long names ping-pong only when
   * the panel advances them, as the menu does with the player's name.
   * @param {number} timestamp - What the animation loop was given.
   */
  loopEntity(timestamp) {
    this.nameEntities.forEach((entity) => entity.loopEntity(timestamp));
  } // loopEntity

} // HallOfFameEntity
