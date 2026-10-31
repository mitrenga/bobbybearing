const { AbstractEntity } = await import('./svision/js/abstractEntity.js?ver='+window.srcVersion);
const { TextEntity } = await import('./svision/js/platform/canvas2D/textEntity.js?ver='+window.srcVersion);
const { ButtonEntity } = await import('./svision/js/platform/canvas2D/buttonEntity.js?ver='+window.srcVersion);
const { ZXColor } = await import('./svision/js/platform/canvas2D/zx/zxColor.js?ver='+window.srcVersion);
// begin code

/**
 * ABOUT GAME as a modal panel over the menu, where its dialogs open
 * (menuModel.js) — the menu keeps turning under it, as under SETTINGS.
 *
 * ? **Silent until M6.** Whether the original has a tune is not measured,
 * and nothing is played in its place.
 *
 * The title bar keeps the dialog's counter: five clicks on it show the game
 * statistics from the server, five more the system information, five more the
 * text again. CLOSE (Escape, GamepadExit) closes the panel, MORE INFO
 * (Enter, GamepadOK) opens the about page.
 */
export class AboutEntity extends AbstractEntity {

  constructor(parentEntity, x, y, width, height) {
    super(parentEntity, x, y, width, height, false, ZXColor.black);
    this.id = 'AboutEntity';

    this.panelBkColor = ZXColor.black;

    this.aboutText = 'BOBBY BEARING IS A REMAKE OF THE 1986 GAME BY ROBERT AND TREVOR FIGGINS, PUBLISHED BY THE EDGE FOR THE ZX SPECTRUM.\n' +
                    'BOBBY IS A STEEL BALL WHO ROLLS OVER THE CURVED SURFACES OF THE METAPLANES TO PUSH HIS FOUR ' +
                    'STUNNED BROTHERS BACK HOME BEFORE THE TIME RUNS OUT.\n' +
                    'THE REMAKE IS IN ITS EARLY STAGES: THE ORIGINAL HAS BEEN TAKEN APART, THE GAME ITSELF COMES NEXT.\n' +
                    'THE HIGH SCORES ARE KEPT IN THE HALL OF FAME ON THE SERVER.';
    this.statsText = 'error:\nstatistics data not available!';
    this.clickCounter = 0;
  } // constructor

  init() {
    super.init();

    var w = this.width, h = this.height;
    this.addEntity(new ButtonEntity(this, this.app.fonts.fonts5x5, 0, 0, w, 9, 'ABOUT GAME', {id: 'clickLabel'}, [], ZXColor.brightRed, false, {align: 'center', topMargin: 2, member: 'titleBar', hoverColor: ZXColor.black, clickColor: ZXColor.black}));
    this.addEntity(new AbstractEntity(this, 1, 9, w-2, h-10, false, this.panelBkColor));
    this.addEntity(new TextEntity(this, this.app.fonts.fonts5x5, 1, 9, w-2, h-25, this.aboutText, ZXColor.brightWhite, false, {align: 'justify', textWrap: true, margin: 2, member: 'aboutText'}));
    this.addEntity(new ButtonEntity(this, this.app.fonts.fonts5x5, 3, h-16, 54, 13, 'MORE INFO', {id: 'openAboutURL'}, ['Enter', 'GamepadOK'], ZXColor.brightWhite, ZXColor.green, {align: 'center', margin: 4}));
    this.addEntity(new ButtonEntity(this, this.app.fonts.fonts5x5, w-39, h-16, 36, 13, 'CLOSE', {id: 'closeAbout'}, ['Escape', 'GamepadExit'], ZXColor.brightWhite, ZXColor.blue, {align: 'center', margin: 4}));

    this.fetchData('stats.db', false, {});
  } // init

  setData(data) {
    this.statsText = '';
    Object.entries(data.data).forEach(([periodKey, periodValue]) => {
      this.statsText += periodKey + ': [';
      Object.entries(periodValue).forEach(([key, value]) => {
        this.statsText += key + ':' + value + ', ';
      });
      this.statsText = this.statsText.slice(0, -2) + ']\n';
    });
  } // setData

  errorData(error) {
  } // errorData

  /**
   * Switches the panel between the about text, the statistics and the system
   * information, by the count of clicks on the title bar.
   * @returns {void}
   */
  updateAbout() {
    switch (Math.floor(this.clickCounter/5)) {
      case 1:
        this.sendEvent(1, 0, {id: 'updateEntity', member: 'titleBar', text: 'GAME STATS'});
        this.sendEvent(1, 0, {id: 'updateEntity', member: 'aboutText', text: this.statsText});
        break;
      case 2:
        this.sendEvent(1, 0, {id: 'updateEntity', member: 'titleBar', text: 'SYSTEM INFO'});
        var ipLabelSeparator = ' ';
        if (window.clientIP.indexOf(':') >= 0) {
          ipLabelSeparator = '\n';
        }
        var sysInfoText =
          'version: ' + this.app.version + '\n' +
          'element: ' + this.app.element.clientWidth + ' x ' + this.app.element.clientHeight + '\n' +
          'canvas: ' + this.app.element.width + ' x ' + this.app.element.height + '\n' +
          'ratio: ' + this.app.layout.ratio + '\n' +
          'ip:' + ipLabelSeparator + window.clientIP + '\n';
        this.sendEvent(1, 0, {id: 'updateEntity', member: 'aboutText', text: sysInfoText});
        break;
      default:
        this.sendEvent(1, 0, {id: 'updateEntity', member: 'titleBar', text: 'ABOUT GAME'});
        this.sendEvent(1, 0, {id: 'updateEntity', member: 'aboutText', text: this.aboutText});
        break;
    }
  } // updateAbout

  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    switch (event.id) {
      case 'closeAbout':
        this.destroy();
        return true;

      case 'openAboutURL':
        window.location.href = 'about';
        return true;

      case 'clickLabel':
        if (this.clickCounter < 14) {
          this.clickCounter++;
        } else {
          this.clickCounter = 0;
        }
        if (this.clickCounter%5 == 0) {
          this.updateAbout();
        }
        return true;

      case 'resizeModel':
        if (this.clickCounter > 9) {
          this.updateAbout();
        }
        return false;

    }

    return false;
  } // handleEvent

} // AboutEntity
