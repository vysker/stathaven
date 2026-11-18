CREATE TABLE IF NOT EXISTS session(
  id             INTEGER PRIMARY KEY,
  scenario_name  VARCHAR(50) NOT NULL,
  win            BOOLEAN NOT NULL,
  scenario_level TINYINT NOT NULL,
  bonus_xp       TINYINT NOT NULL
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
  items_used        TINYINT,
  start_xp          INTEGER,
  end_xp            INTEGER,
  end_level         TINYINT
);

CREATE VIEW IF NOT EXISTS session_stats_enriched AS
WITH scored AS (
  SELECT
    ss.session_id,
    s.win,
    ch.name AS character_name,
    ss.end_level,
    ss.enemies_killed,
    ss.damage_done,
    ss.damage_taken,
    ss.healing_done,
    ss.loot_collected,
    ss.chests_looted,
    ss.ability_xp_earned,
    -- looted value (higher = more value looted (probably))
    ROUND(
      (ss.loot_collected * 2.0 + ss.chests_looted * 5.0),
      2
    ) AS looted_value,
    -- greed ratio (higher = more loot per point of team contribution)
    ROUND(
      (ss.loot_collected * 2.0 + ss.chests_looted * 5.0) / NULLIF(ss.damage_done + ss.damage_taken + ss.healing_done, 0),
      2
    ) AS greed_ratio,
    -- damage per kill; lower = kill stealer; NULL if 0 kills so they don't win by default
    ROUND(
      ss.damage_done / NULLIF(ss.enemies_killed, 0),
      2
    ) AS damage_per_kill,
    ROUND(
      (ss.damage_done * 1.0) +
      (ss.damage_taken * 1.0) +
      (ss.healing_done * 1.0) -
      ((ss.loot_collected * 2.0 + ss.chests_looted * 5.0) * 2.0),
      2
    ) AS performance_score
  FROM session_stats ss
  JOIN session s ON ss.session_id = s.id
  JOIN character ch ON ch.id = ss.character_id
),
ranked AS (
  SELECT
    *,
    -- Require > 0 loot to prevent awarding Loot Goblin when nobody looted
    CASE
      WHEN loot_collected > 0
      THEN RANK() OVER (PARTITION BY session_id ORDER BY looted_value DESC)
    END AS rnk_loot_goblin,
    
    CASE
      WHEN loot_collected > 0
      THEN RANK() OVER (PARTITION BY session_id ORDER BY greed_ratio DESC)
    END AS rnk_greed_is_good,

    CASE
      WHEN enemies_killed >= 2
      THEN RANK() OVER (PARTITION BY session_id ORDER BY damage_per_kill ASC)
    END AS rnk_kill_stealer,

    CASE
      WHEN damage_taken > 0
      THEN RANK() OVER (PARTITION BY session_id ORDER BY damage_taken DESC)
    END AS rnk_punching_bag,

    RANK() OVER (PARTITION BY session_id ORDER BY performance_score DESC) AS rnk_mvp,
    RANK() OVER (PARTITION BY session_id ORDER BY performance_score ASC)  AS rnk_scapegoat
  FROM scored
)
SELECT
  session_id,
  character_name,
  end_level as level,
  enemies_killed,
  damage_done,
  damage_taken,
  healing_done,
  loot_collected,
  chests_looted,
  ability_xp_earned,
  -- Combine all earned trophies into a comma-separated string (NULL if none earned)
  NULLIF(
    TRIM(
      CASE WHEN rnk_mvp = 1                   THEN 'MVP, '           ELSE '' END ||
      CASE WHEN win = 0 AND rnk_scapegoat = 1 THEN 'Scapegoat, '     ELSE '' END ||
      CASE WHEN rnk_loot_goblin = 1           THEN 'Loot Goblin, '   ELSE '' END ||
      CASE WHEN rnk_greed_is_good = 1         THEN 'Greed is Good, ' ELSE '' END ||
      CASE WHEN rnk_kill_stealer = 1          THEN 'Kill Stealer, '  ELSE '' END ||
      CASE WHEN rnk_punching_bag = 1          THEN 'Punching Bag, '  ELSE '' END,
      ', '
    ),
    ''
  ) AS trophies
FROM ranked;

CREATE VIEW IF NOT EXISTS median_damage_per_scenario AS
WITH ordered_stats AS (
    SELECT 
        character_id,
        damage_done,
        ROW_NUMBER() OVER (PARTITION BY character_id ORDER BY damage_done) AS row_num,
        COUNT(*) OVER (PARTITION BY character_id) AS total_rows
    FROM session_stats
)
SELECT 
    c.name,
    AVG(os.damage_done) AS median_damage_done
FROM ordered_stats os
JOIN character c ON os.character_id = c.id
WHERE os.row_num IN ((os.total_rows + 1) / 2, (os.total_rows + 2) / 2)
GROUP BY c.id;

CREATE VIEW IF NOT EXISTS best_buddies AS
SELECT 
    c1.name AS character,
    c2.name AS buddy,
    COUNT(*) AS shared_sessions
FROM session_stats ss1
JOIN session_stats ss2 
    ON ss1.session_id = ss2.session_id 
    AND ss1.character_id < ss2.character_id -- Prevents duplicate pairs (A-B and B-A) and self-matching
JOIN character c1 ON ss1.character_id = c1.id
JOIN character c2 ON ss2.character_id = c2.id
GROUP BY c1.id, c2.id
ORDER BY shared_sessions DESC;

CREATE VIEW IF NOT EXISTS basic_character_stats AS
SELECT
  c.name as character,
  COUNT(ss.session_id) AS sessions_played,
  SUM(ss.enemies_killed) AS total_kills,
  SUM(ss.damage_done) AS total_dmg_done,
  SUM(ss.damage_taken) AS total_dmg_taken,
  SUM(ss.healing_done) AS total_healing,
  SUM(ss.loot_collected) AS total_loot,
  SUM(ss.chests_looted) AS total_chests,
  SUM(ss.ability_xp_earned) AS total_xp,
  SUM(ss.items_used) AS total_items,
  ROUND(AVG(ss.damage_done), 1) AS avg_dmg_done,
  ROUND(AVG(ss.ability_xp_earned), 1) AS avg_xp,
  MAX(ss.damage_done) AS max_dmg_done,
  MIN(ss.damage_done) AS min_dmg_done
FROM character c
JOIN session_stats ss ON c.id = ss.character_id
GROUP BY c.id;