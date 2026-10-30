SELECT `ndx`, `name`, `brothers`, `rooms`, `time`, `created`
FROM `rg_bb_hallOfFame`
ORDER BY `ndx` DESC
LIMIT :limit
