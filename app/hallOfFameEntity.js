const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
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
 * is **the remake's**: six places, 1ST to 6TH, off the server, ranked by
 * the three numbers of gameScore.js (M7, operator 2026-10-30): brothers
 * home down, rooms seen down, the game's time at the last progress up.
 *
 * A row is place, the three numbers and the name, and a name too long for
 * its column ping-pongs (SlidingTextEntity), the way the player's name does
 * in the menu; the menu ticks the panel (loopEntity).
 *
 * CLOSE (Enter, Escape, space, GamepadOK, GamepadExit) closes the panel.
 */
export class HallOfFameEntity extends AbstractEntity {

  constructor(parentEntity, x, y, width, height) {
    super(parentEntity, x, y, width, height, false, ZXColor.black);
    this.id = 'HallOfFameEntity';

    this.rowEntities = [];
    // the names, ticked from loopEntity(): a name too long for its column ping-pongs
    this.nameEntities = [];

    // ? the remake's places, as in the sibling remakes
    this.places = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'];
  } // constructor

  init() {
    super.init();

    // all on the black of the panel itself: the heading, the CLOSE button and
    // the six places drawn by showTable()
    var w = this.width, h = this.height;
    // the heading in the title bar every panel of the game has (aboutEntity.js,
    // the dialogs of menuModel.js): fonts5x5, bright red, 9 px from the top
    // with a 2 px margin, centred; the text is the remake's, see above
    this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, 0, 0, w, 9, 'HALL OF FAME', ZXColor.brightRed, false, {align: 'center', topMargin: 2}));
    this.addEntity(new ButtonEntity(this, this.app.fonts.fonts5x5, w-39, h-16, 36, 13, 'CLOSE', {id: 'closeHallOfFame'}, ['Enter', 'Escape', ' ', 'GamepadOK', 'GamepadExit'], ZXColor.brightWhite, ZXColor.blue, {align: 'center', margin: 4}));

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
   * Draws the six places.
   * @param {Array} rows - [{name, brothers, rooms, time}] in the order of
   *   the hall of fame (db/hallOfFame.php).
   * @param {boolean} original - True when these are the original's own entries.
   */
  showTable(rows, original) {
    this.rowEntities.forEach((entity) => entity.destroy());
    this.rowEntities = [];
    this.nameEntities = [];
    var w = this.width, h = this.height;
    // the places in pairs, from the top down in the colours of the panel:
    // white, yellow, cyan — on black; 6 px between the rows
    var colors = [ZXColor.brightWhite, ZXColor.brightWhite, ZXColor.brightYellow, ZXColor.brightYellow, ZXColor.brightCyan, ZXColor.brightCyan];
    // the three columns under their headings: brothers (one digit), rooms
    // (up to three), time (five), each flush right; 4 px apart; the name
    // takes what is left of the row
    var columns = [{x: 38, width: 8, head: 'B', get: (r) => String(r.brothers)},
                   {x: 50, width: 24, head: 'ROOMS', get: (r) => String(r.rooms)},
                   {x: 78, width: 40, head: 'TIME', get: (r) => GameScore.time(r)}];
    columns.forEach((column) => {
      var head = new TextEntity(this, this.app.fonts.fonts5x5, column.x, 13, column.width, 5, column.head, ZXColor.brightRed, false, {align: 'right'});
      this.addEntity(head);
      this.rowEntities.push(head);
    });
    for (var i = 0; i < this.places.length; i++) {
      var y = 22+i*14;
      var row = rows[i];
      var color = colors[i];
      var place = new TextEntity(this, this.app.fonts.zxFonts8x8, 4, y, 26, 8, this.places[i], color, false, {align: 'right'});
      this.addEntity(place);
      this.rowEntities.push(place);
      columns.forEach((column) => {
        var cell = new TextEntity(this, this.app.fonts.zxFonts8x8Mono, column.x, y, column.width, 8, row ? column.get(row) : '', color, false, {align: 'right'});
        this.addEntity(cell);
        this.rowEntities.push(cell);
      });
      var name = new SlidingTextEntity(this, this.app.fonts.zxFonts8x8, 122, y, w-122-4, 8, row ? String(row.name) : '', color, false, {align: 'right', animation: 'pingPong', speed: 30});
      this.addEntity(name);
      this.rowEntities.push(name);
      this.nameEntities.push(name);
    }
    if (original) {
      var note = new TextEntity(this, this.app.fonts.fonts5x5, 4, h-16, w-48, 12,
        navigator.onLine ? 'THE ORIGINAL TABLE - NOBODY HAS PLAYED YET' : 'SYSTEM OFFLINE - THE ORIGINAL TABLE',
        ZXColor.brightRed, false, {textWrap: true, margin: 1});
      this.addEntity(note);
      this.rowEntities.push(note);
    }
  } // showTable

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
