from os import listdir
from os.path import isfile, join
import math
import os
import csv
import sqlite3

# (level, required_xp)
XP_THRESHOLDS = [
    (1, 0),
    (2, 45),
    (3, 95),
    (4, 150),
    (5, 210),
    (6, 275),
    (7, 345),
    (8, 420),
    (9, 500),
]

def xp_to_level(xp: int) -> int:
    level = 1
    for lvl, min_xp in XP_THRESHOLDS:
        if xp >= min_xp:
            level = lvl
    return level

def level_to_min_xp(level: int) -> int:
    for lvl, min_xp in XP_THRESHOLDS:
        if lvl == level:
            return min_xp
    return 0

if __name__ == '__main__':
    data_path = 'data/'

    with open('schema.sql', 'r') as sql_file:
        schema_sql = sql_file.read()
    with open('characters.sql', 'r') as sql_file:
        characters_sql = sql_file.read()

    db_filename = 'stathaven.db'
    if isfile(db_filename):
        os.remove(db_filename)

    db = sqlite3.connect(db_filename)
    db_cursor = db.cursor()
    db_cursor.executescript(schema_sql)
    db_cursor.executescript(characters_sql)
    db.commit()

    session_files = []
    for file in listdir(data_path):
        filepath = join(data_path, file)
        if not isfile(filepath) or not file.endswith('.csv'):
            continue
        session_str, scenario, outcome = file[:-len(".csv")].split(sep="_")
        session_files.append((int(session_str), scenario, outcome, filepath))

    # Sorting by session_id is important for calculating XP
    session_files.sort(key=lambda item: item[0])

    character_xp = {} # Cumulative XP per character_id
    session_stats_data = []

    for session_id, scenario, outcome, filepath in session_files:
        win = outcome == "Victory"

        raw_rows = []
        with open(filepath, newline='') as csvfile:
            csv_rows = csv.reader(csvfile)
            next(csv_rows, None)  # skip header
            for csv_row in csv_rows:
                nickname = csv_row[0]
                db_result = db.execute(
                    "SELECT id FROM character WHERE nickname = ?",
                    (nickname,)
                ).fetchone()
                if db_result is None:
                    raise ValueError(f"Character nickname '{nickname}' not found in character table (file: {filepath})")
                character_id = int(db_result[0])
                stats = [int(val) for val in csv_row[1:]]
                raw_rows.append((character_id, stats))

        # Calculate starting XP & level for every character in this session.
        # Existing characters use their current XP; new characters infer from party level
        existing_levels = [
            xp_to_level(character_xp[char_id])
            for char_id, _ in raw_rows
            if char_id in character_xp
        ]
        prior_party_avg = (sum(existing_levels) / len(existing_levels)) if existing_levels else 1.0
        new_char_start_lvl = math.ceil(prior_party_avg / 2.0)

        session_start_xp = {}
        session_start_levels = []
        for char_id, _ in raw_rows:
            if char_id not in character_xp:
                character_xp[char_id] = level_to_min_xp(new_char_start_lvl)
            session_start_xp[char_id] = character_xp[char_id]
            session_start_levels.append(xp_to_level(character_xp[char_id]))

        # Scenario level = CEIL(AVG(party_level) / 2.0) for the active party
        scenario_level = math.ceil((sum(session_start_levels) / len(session_start_levels)) / 2.0)
        bonus_xp = (4 + 2 * scenario_level) if win else 0

        print(f"Session {session_id}: {scenario} ({outcome}) | Scenario Lvl {scenario_level} | Bonus XP {bonus_xp}")
        db.execute(
            "INSERT INTO session VALUES (?, ?, ?, ?, ?)",
            (session_id, scenario, win, scenario_level, bonus_xp)
        )

        # Add ability XP + scenario bonus XP and record end state
        for char_id, stats in raw_rows:
            # stats order: enemies_killed, damage_done, damage_taken, healing_done,
            #              loot_collected, chests_looted, ability_xp_earned, items_used
            ability_xp_earned = stats[6]
            start_xp = session_start_xp[char_id]
            end_xp = start_xp + ability_xp_earned + bonus_xp
            end_level = xp_to_level(end_xp)

            character_xp[char_id] = end_xp
            session_stats_data.append((session_id, char_id, *stats, start_xp, end_xp, end_level))

    db_cursor.executemany(
        "INSERT INTO session_stats VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        session_stats_data
    )
    db.commit()
    db.close()
