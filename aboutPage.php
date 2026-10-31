<?php

require_once 'app/svision/php/abstractAboutPage.php';

/**
 * The /about page: the story of the original Bobby Bearing and of this remake.
 */
class AboutPage extends AbstractAboutPage {

  protected function aboutData() {
    return [
      'image' => 'images/cover.png',
      'sections' => [
        [
          'heading' => 'The original game (1986)',
          'html' =>
            '<p>Bobby Bearing was written by Robert and Trevor Figgins and published by The Edge in 1986 '.
            'for the ZX Spectrum. Bobby is a steel ball, and his four brothers have been led astray into '.
            'the Metaplanes by a rogue cousin and stunned by the evil Bearings. Bobby has to find them one '.
            'by one and push them back home over curved, isometric surfaces — the game calls it '.
            '"Curvispace 3D" — before the time runs out.</p>'.
            '<p>The Metaplanes are a maze of 245 rooms of slopes, ramps and gaps to fall through. Bobby '.
            'rolls with momentum, so a brother is nudged home rather than carried, and the rooms fight '.
            'back: lifts that crush, blocks that come and go on a timer or at a switch, magnets, air vents '.
            'that blow a ball away, balls that give chase and the evil Bearings themselves.</p>',
        ],
        [
          'heading' => 'This remake',
          'html' =>
            '<p>This is a faithful remake, rewritten for the web browser rather than emulated, and the whole '.
            'game is playable: all 245 rooms, the four brothers, the lifts, blocks, magnets, vents and the '.
            'evil Bearings, the start of a game and all its endings, and the original\'s sounds.</p>'.
            '<p>Nothing in it is redrawn or guessed. The rooms, the graphics and the texts are taken out of '.
            'the original program, and the game itself is the original\'s main loop rewritten pass by pass '.
            'over memory laid out as on the Spectrum — the rolling is the original\'s own integer arithmetic, '.
            'not a physics engine that looks alike. It was checked against the running original, down to a '.
            'whole recorded game played through again and compared after every pass.</p>'.
            '<p>The tape loads the way it did in 1986: LOAD TAPE plays the original cassette with its Alkatraz '.
            'loader, and the loading screen appears byte by byte in the loader\'s own order. The menu is the '.
            'original\'s screen after a game — roll the ball onto a disc to pick an item, or onto the arrow to '.
            'start.</p>'.
            '<p>It runs directly in your browser — nothing to install, nothing to download. Keyboard with '.
            'keys of your own choosing, touch controls and gamepads are supported.</p>'.$this->installNote(),
        ],
        [
          'heading' => 'Other games',
          'html' =>
            '<p>This remake is one of a growing collection of classic games from the 8-bit and 16-bit era '.
            '— ZX Spectrum, Commodore 64, arcade and more — rebuilt faithfully on the same library and '.
            'playable in your browser, free of charge. Browse the whole collection at '.
            '<a href="https://retrogames.free/" target="_blank" rel="noopener">retrogames.free</a>.</p>',
        ],
      ],
      'links' => [
        ['label' => 'Bobby Bearing on Wikipedia', 'url' => 'https://en.wikipedia.org/wiki/Bobby_Bearing'],
        ['label' => 'Bobby Bearing at Spectrum Computing', 'url' => 'https://spectrumcomputing.co.uk/entry/606/ZX-Spectrum/Bobby_Bearing'],
        ['label' => 'Bobby Bearing at World of Spectrum', 'url' => 'https://worldofspectrum.org/software?id=0000606'],
        ['label' => 'Robert Figgins — his games at Spectrum Computing', 'url' => 'https://spectrumcomputing.co.uk/list?label_id=12387'],
        ['label' => 'Trevor Figgins — his games at Spectrum Computing', 'url' => 'https://spectrumcomputing.co.uk/list?label_id=14807'],
      ],
      'footer' =>
        '<p>An unofficial fan remake. The original game and its artwork belong to their authors '.
        '(Robert and Trevor Figgins) and their publisher (The Edge). '.
        'Remake source code is available on <a href="https://github.com/mitrenga/bobbybearing" target="_blank" rel="noopener">GitHub</a> '.
        'under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>.</p>',
    ];
  } // aboutData

} // AboutPage
