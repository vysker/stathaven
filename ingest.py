from os import listdir
from os.path import isfile, join
import os
import csv
import sqlite3

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

    session_stats_data = []
    
    for file in listdir(data_path):
        filepath = join(data_path, file)

        if not isfile(filepath):
            continue

        [session, scenario, outcome] = file[:-len(".csv")].split(sep="_")
        print("%s, %s, %s" % (session, scenario, outcome))

        win = True if outcome == "Victory" else False
        db.execute("INSERT INTO session VALUES (?, ?, ?)", (session, scenario, win))
        db_cursor = db.cursor()

        with open(filepath) as csvfile:
            csv_rows = csv.reader(csvfile)
            csv_row_num = 0
            for csv_row in csv_rows:
                csv_row_num += 1
                if csv_row_num == 1:
                    continue # skip header
                nickname = csv_row[0]
                session_id = int(session)
                db_result = db.execute("SELECT id FROM character WHERE nickname = '%s'" % nickname)
                character_id = int(db_result.fetchone()[0])
                # In `*csv_row[1:]` the `*`` means 'splat' everything after first csv column
                session_stats_data.append((session_id, character_id, *csv_row[1:]))

    # session_id
    # character_id
    # enemies_killed
    # damage_done
    # damage_taken
    # healing_done
    # loot_collected
    # chests_looted
    # ability_xp_earned
    # items_used
    db_cursor.executemany("INSERT INTO session_stats VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", session_stats_data)
    db.commit()
    db.close()
