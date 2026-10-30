<?php

require_once 'app/svision/php/abstractAboutPage.php';

/**
 * The /about page: the story of the original Bobby Bearing and of this remake.
 * Skeleton text; the final content comes with M7.
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
            '"Curvispace 3D" — before the time runs out.</p>',
        ],
        [
          'heading' => 'This remake',
          'html' =>
            '<p>This is a faithful remake, rewritten for the web browser rather than emulated. The graphics '.
            'and the rules are taken out of the original program, not redrawn and not copied from a wiki — '.
            'where a rule cannot be shown, it is left as an open question rather than guessed, and the '.
            'attribute clash of the hardware is reproduced instead of cleaned up.</p>'.
            '<p>It is being built in milestones: the tape has been taken apart — an Alkatraz loader in dozens '.
            'of encryption layers — the loading screen is the real one loaded byte by byte off it, in the '.
            'loader\'s own order, and the opening screen is the original\'s own picture unpacked out of the '.
            'program. The rolling itself has not been read out of the program yet. That is the method, not '.
            'an oversight.</p>'.
            '<p>It runs directly in your browser — nothing to install, nothing to download. Keyboard, '.
            'touch controls and gamepads are supported.</p>'.$this->installNote(),
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
        ['label' => 'Bobby Bearing at Spectrum Computing', 'url' => 'https://spectrumcomputing.co.uk/entry/606/'],
        ['label' => 'Bobby Bearing at World of Spectrum', 'url' => 'https://worldofspectrum.org/software?id=0000606'],
        ['label' => 'Retro Games — more classic remakes playable in your browser', 'url' => 'https://retrogames.free/'],
      ],
      'footer' =>
        '<p>An unofficial fan remake. The original game and its artwork belong to their authors '.
        '(Robert and Trevor Figgins) and their publisher (The Edge). '.
        'The remake\'s source code is licensed under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>.</p>',
    ];
  } // aboutData

} // AboutPage
