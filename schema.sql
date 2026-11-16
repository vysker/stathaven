CREATE TABLE IF NOT EXISTS session(
  id            INTEGER PRIMARY KEY,
  scenario_name VARCHAR(50) NOT NULL,
  win           BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS character(
  id       INTEGER PRIMARY KEY,
  name     VARCHAR(20) NOT NULL,
  nickname VARCHAR(20) NOT NULL,
  player   VARCHAR(20) NOT NULL
);

CREATE TABLE IF NOT EXISTS session_stats(
  session_id        TINYINT, -- REFERENCES(id) session
  character_id      TINYINT, -- REFERENCES(id) session
  enemies_killed    TINYINT,
  damage_done       TINYINT,
  damage_taken      TINYINT,
  healing_done      TINYINT,
  loot_collected    TINYINT,
  chests_looted     TINYINT,
  ability_xp_earned TINYINT,
  items_used        TINYINT
);

