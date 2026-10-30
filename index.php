<?php
  $appName = 'BOBBY BEARING';
  $appDescription = 'Play BOBBY BEARING online for free in your browser. Faithful remake of the 1986 ZX Spectrum game by Robert and Trevor Figgins, no download required.';
  $appPrefix = 'bb';
  $appNoscript =
    '<h1>BOBBY BEARING</h1>'.
    '<p>Bobby Bearing is the 1986 ZX Spectrum game by Robert and Trevor Figgins, published by The Edge. '.
    'Bobby is a steel ball who rolls over the curved surfaces of the Metaplanes to push his four stunned '.
    'brothers back home before the time runs out.</p>'.
    '<p>This is a faithful remake that runs directly in your web browser. '.
    'There is nothing to install and nothing to download — just open the page and play. '.
    'Please enable JavaScript to start the game.</p>'.
    '<p><a href="about">More about Bobby Bearing and this remake</a></p>';
  $appOpenGraph = [
    'image' => 'images/poster.png',
  ];
  $appJsonLd = [
    'genre' => 'Action',
    'isBasedOn' => [
      '@type' => 'VideoGame',
      'name' => 'Bobby Bearing',
      'author' => [
        ['@type' => 'Person', 'name' => 'Robert Figgins'],
        ['@type' => 'Person', 'name' => 'Trevor Figgins'],
      ],
      'publisher' => [
        ['@type' => 'Organization', 'name' => 'The Edge'],
      ],
      'datePublished' => '1986',
      'gamePlatform' => 'ZX Spectrum',
    ],
  ];
  require_once 'config/config.php';
  require_once 'app/svision/php/main.php';
