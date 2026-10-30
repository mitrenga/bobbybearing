<?php

class DataCommand {

  // Co se posílá při startu aplikace.
  //
  // - `screen`   – úvodní obrazovka originálu jako data programu (komprimovaný
  //                obraz z $DA30, skládá ho převod $D9D8) (M1)
  // - `loading`  – loading screen a pořadí, v jakém ho zavaděč odkrývá (M1)
  // - `tape`     – scénář pro LOAD TAPE: bloky kazety a jejich časování (M1)
  // - `overlay`  – co zavaděč kreslí během bloku 4: běžící text, počítadlo (M1)
  // - `world`    – místnosti jako úseky paměti originálu; staví z nich worker
  //                (app/worldRenderer.js, M2)
  // - `memory`   – zbytek paměti originálu na startu hry, nad kterou worker
  //                hraje převodem hlavní smyčky (tools/mkmemory.mjs, M3)
  //
  // Chybějící soubor dorazí jako null a aplikace to musí přežít.
  //
  // Databázi start aplikace nepotřebuje: originál nemá skóre, takže tu není
  // žádné HI, a síň slávy si tabulku čte sama (`hallOfFame.db`).
  var $files = ['screen', 'loading', 'tape', 'overlay', 'world', 'memory'];

  public function execute($postData) {
    $result = [];
    foreach ($this->files as $file) {
      $fileName = 'data/'.$file.'.json';
      if (!is_file($fileName)) {
        // optional data files (those a later milestone adds) arrive as null
        $result[$file] = null;
        continue;
      }
      $dataJSON = file_get_contents($fileName);
      try {
        $result[$file] = json_decode($dataJSON, false, 512, JSON_THROW_ON_ERROR);
      }
      catch (\JsonException $exception) {
        $result[$file] = ['error' => ['message' => $exception->getMessage()]];
      }
    }

    return $result;
  } // execute

} // class DataCommand
