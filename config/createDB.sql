SET @dbname = 'bobbybearing';

SET @query = CONCAT('CREATE DATABASE IF NOT EXISTS `', @dbname, '`');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @query = CONCAT('USE `', @dbname, '`');
PREPARE stmt FROM @query;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- M7: the remake's score is three columns (operator 2026-10-30): brothers
-- home (0-5), rooms seen without the starting one, and the game's time gone
-- by at the last progress in ticks of the original's clock (eight to a unit
-- of the panel); ranked brothers DESC, rooms DESC, time ASC
CREATE TABLE IF NOT EXISTS rg_bb_hallOfFame (
  `ndx` BIGINT(20) NOT NULL AUTO_INCREMENT,
  `name` CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `brothers` TINYINT NOT NULL,
  `rooms` SMALLINT NOT NULL,
  `time` INT NOT NULL,
  `created` TIMESTAMP NOT NULL,
  PRIMARY KEY (`ndx`),
  INDEX `rank` (`brothers`, `rooms`, `time`),
  INDEX `name` (`name`),
  INDEX `created` (`created`),
  INDEX `created_name` (`created`, `name`)
);
