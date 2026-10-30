<?php

class DataCommand {

   // M7: a finished game — the original's end or EXIT GAME (R-049) — with
   // the remake's three numbers; a game that got nowhere is not sent
   public function execute($postData) {
      $data = json_decode($postData);
      $mysqli = new mysqli($GLOBALS['dbHostname'], $GLOBALS['dbUser'], $GLOBALS['dbPassword'], $GLOBALS['dbName']);
      $stmt = $mysqli->prepare('INSERT INTO `rg_bb_hallOfFame` (`name`, `brothers`, `rooms`, `time`, `created`) VALUES (?, ?, ?, ?, NOW())');
      $name = (string)$data->name;
      $brothers = (int)$data->brothers;
      $rooms = (int)$data->rooms;
      $time = (int)$data->time;
      $stmt->bind_param('siii', $name, $brothers, $rooms, $time);
      $stmt->execute();
      $stmt->close();
      $mysqli->close();
      return ['saved' => true];
   } // execute

} // class DataCommand
