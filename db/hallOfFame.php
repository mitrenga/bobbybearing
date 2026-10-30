<?php

class DataCommand {

   // M7: the remake's three columns (operator 2026-10-30) — brothers home
   // and rooms seen down, the game's time at the last progress up; one row
   // a name, its best game
   public function execute($postData) {
      $mysqli = new mysqli($GLOBALS['dbHostname'], $GLOBALS['dbUser'], $GLOBALS['dbPassword'], $GLOBALS['dbName']);
      $data = $mysqli->query('SELECT h.`name`, h.`brothers`, h.`rooms`, h.`time` FROM `rg_bb_hallOfFame` h'
        .' LEFT JOIN `rg_bb_hallOfFame` b ON b.`name` = h.`name` AND (b.`brothers` > h.`brothers`'
        .' OR (b.`brothers` = h.`brothers` AND b.`rooms` > h.`rooms`)'
        .' OR (b.`brothers` = h.`brothers` AND b.`rooms` = h.`rooms` AND b.`time` < h.`time`)'
        .' OR (b.`brothers` = h.`brothers` AND b.`rooms` = h.`rooms` AND b.`time` = h.`time` AND b.`ndx` < h.`ndx`))'
        .' WHERE b.`ndx` IS NULL ORDER BY h.`brothers` DESC, h.`rooms` DESC, h.`time` ASC, h.`ndx` ASC LIMIT 6');
      $mysqli->close();
      return $data;
   } // execute

} // class DataCommand
