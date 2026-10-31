const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
const { GameScore } = await import('./gameScore.js?ver='+window.srcVersion);
const { FramedPanelEntity } = await import('./framedPanelEntity.js?ver='+window.srcVersion);
// begin code

/**
 * The remake's screen after a game: the three numbers of the score, stored
 * in the hall of fame on the server, and the menu after a countdown.
 *
 * ★ The original has no such screen and no score: its end is the end
 * screen `$7D06` (≈ 7 s, gameModel.js), then its screen of controls. This
 * one comes between the two, for the game's own end and for EXIT GAME in
 * the pause alike (R-049). What it shows is the remake's (M7, operator
 * 2026-10-30): brothers home, rooms seen and the game's time at the last
 * progress — gameWorker.js score(). A game that got nowhere is shown but
 * not stored.
 *
 * The texts are in the remake's font (gameApp.js zxFonts8x8Menu), the
 * button rounds its corners as the framed panels' do (operator 2026-10-31).
 */
export class GameOverModel extends AbstractModel {

  constructor(app, nextModel) {
    super(app);
    this.id = 'GameOverModel';

    this.nextModel = nextModel;
    this.countdownLength = 8;
    this.buttonEntity = null;
    this.timerEntity = null;
  } // constructor

  init() {
    super.init();

    this.desktopEntity.bkColor = ZXColor.black;
    this.borderEntity.bkColor = ZXColor.black;

    var score = this.app.score || GameScore.empty();
    this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Menu, 0, 8*8, this.desktopWidth, 8, 'GAME OVER', ZXColor.brightRed, false, {align: 'center'}));
    // the three columns of the hall of fame, one under the other, the
    // numbers flush right in a column of their own
    var rows = [['BROTHERS HOME', String(score.brothers)+' OF 5', ZXColor.brightWhite],
                ['ROOMS SEEN', String(score.rooms), ZXColor.brightYellow],
                ['TIME', String(Number(GameScore.time(score))), ZXColor.brightCyan]];   // without the leading zeros (operator 2026-10-31)
    rows.forEach((row, i) => {
      var y = (11+2*i)*8;
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Menu, 4*8, y, 14*8, 8, row[0], row[2], false, {}));
      this.desktopEntity.addEntity(new TextEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Menu, 18*8, y, 10*8, 8, row[1], row[2], false, {align: 'right'}));
    });
    this.buttonEntity = new ButtonEntity(this.desktopEntity, this.app.fonts.zxFonts8x8Menu, this.desktopWidth/2-35, 22*8-4, 70, 12, 'MENU', {id: this.nextModel}, ['Enter', 'Escape', ' ', 'GamepadOK', 'GamepadExit'], ZXColor.brightWhite, ZXColor.green, {topMargin: 2, align: 'center', cornerMask: FramedPanelEntity.BUTTON_CORNER});
    this.desktopEntity.addEntity(this.buttonEntity);
    this.timerEntity = new TextEntity(this.buttonEntity, this.app.fonts.fonts5x5, 8, 4, 10, 5, String(this.countdownLength), ZXColor.white, false, {align: 'center'});
    this.buttonEntity.addEntity(this.timerEntity);

    // ★ the original plays nothing here: its end screen is silent (M6)

    if (!GameScore.isZero(score)) {
      this.fetchData('saveGame.db', false, {name: this.app.playerName, brothers: score.brothers, rooms: score.rooms, time: score.time});
    }
  } // init


  shutdown() {
    super.shutdown();
    this.sendEvent(0, {id: 'stopAllAudioBuses'});
  } // shutdown

  setData(data) {
  } // setData

  errorData(data) {
  } // errorData

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'MenuModel':
        this.app.setModel('MenuModel');
        return true;
    }

    return false;
  } // handleEvent

  loopModel(timestamp) {
    super.loopModel(timestamp);

    if (this.timer === false) {
      this.timer = timestamp;
    }
    var countdown = this.countdownLength-Math.floor((timestamp-this.timer)/1000);
    if (countdown < 0) {
      this.sendEvent(1, {id: this.nextModel});
    } else {
      this.timerEntity.setText(countdown.toString());
    }

    this.drawModel();
  } // loopModel

} // GameOverModel
