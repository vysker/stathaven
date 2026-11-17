'use strict';
(function() {
    const resultContainer = '#result';
    const urlQueryKey = 'query';
    const sessionStatsQueryName = 'sessionStats';

    globalThis.queries = {
        allSessions: 'SELECT * FROM session',
        characterBasicStats:
            `SELECT
                c.nickname,
                c.player,
                COUNT(ss.session_id) AS sessions_played,
                -- Totals
                SUM(ss.enemies_killed) AS total_kills,
                SUM(ss.damage_done) AS total_dmg_done,
                SUM(ss.damage_taken) AS total_dmg_taken,
                SUM(ss.healing_done) AS total_healing,
                SUM(ss.loot_collected) AS total_loot,
                SUM(ss.chests_looted) AS total_chests,
                SUM(ss.ability_xp_earned) AS total_xp,
                SUM(ss.items_used) AS total_items,
                -- Averages (Rounded to 1 decimal)
                ROUND(AVG(ss.damage_done), 1) AS avg_dmg_done,
                ROUND(AVG(ss.ability_xp_earned), 1) AS avg_xp,
                -- Highest / Lowest (Example using damage_done)
                MAX(ss.damage_done) AS max_dmg_done,
                MIN(ss.damage_done) AS min_dmg_done
            FROM character c
            JOIN session_stats ss ON c.id = ss.character_id
            GROUP BY c.id`
    };

    globalThis.cycleSort = function(columnName) {
        const url = new URL(window.location);
        const value = url.searchParams.get(columnName);
        switch (value) {
            case null:   url.searchParams.set(columnName, 'asc'); break;
            case 'asc':  url.searchParams.set(columnName, 'desc'); break;
            case 'desc': url.searchParams.delete(columnName); break;
        }

        history.pushState(null, '', url);
        runNamedQuery(getQueryNameInUrl());
    }

    function getSortCssClass(columnName) {
        const url = new URL(window.location);
        const value = url.searchParams.get(columnName);
        switch (value) {
            case null:   return 'sort-none';
            case 'asc':  return 'sort-asc';
            case 'desc': return 'sort-desc';
            default:     return 'sort-none';
        }
    }

    function getSortsFromUrl() {
        const url = new URL(window.location);
        const sorts = [];
        url.searchParams.forEach((value, key, _) => {
            if (key !== urlQueryKey) {
                sorts.push({column: key, order: value});
            }
        });
        return sorts;
    }

    function createOrderByClauseFromUrl() {
        const sorts = getSortsFromUrl();
        let orderByClause = sorts.map(s => `${s.column} ${s.order}`).join(', ');
        if (orderByClause.length > 0) {
            orderByClause = ' ORDER BY ' + orderByClause;
        }
        return orderByClause;
    }

    globalThis.clearSorts = function() {
        const url = new URL(window.location);
        const sorts = getSortsFromUrl();
        sorts.forEach(s => url.searchParams.delete(s.column));
        history.pushState(null, '', url);
        runNamedQuery(getQueryNameInUrl());
    }

    function getQueryNameInUrl() {
        const url = new URL(window.location);
        return url.searchParams.get(urlQueryKey);
    }

    function runQuery(sql) {
        const columnNames = [];
        const rows = [];
        globalThis.db.exec({
            sql: sql,
            columnNames: columnNames,
            rowMode: 'array',
            callback: function(row) {
                rows.push(row);
            }
        });
        return {columnNames, rows};
    }

    function runNamedQuery(queryName) {
        let sql;
        if (queryName.startsWith(sessionStatsQueryName)) {
            sql = `SELECT * FROM session_stats WHERE session_id = ` + queryName.split('_')[1];
        } else {
            sql = globalThis.queries[queryName];
        }

        sql = sql + createOrderByClauseFromUrl();
        const result = runQuery(sql);

        const url = new URL(window.location);
        url.searchParams.set(urlQueryKey, queryName);
        history.pushState(null, '', url);

        renderQueryResult(queryName, result.columnNames, result.rows);
    }

    function renderQueryResult(queryName, columnNames, rows) {
        const container = document.querySelector(resultContainer);
        const table = document.createElement('table');

        const thead = table.createTHead().insertRow();
        columnNames.forEach(columnName => {
            const th = document.createElement('th');
            th.setAttribute('onclick', `cycleSort('${columnName}')`);
            th.textContent = columnName.replaceAll('_', ' ');
            thead.appendChild(th);
            th.classList.add(getSortCssClass(columnName));
        });

        const tbody = table.createTBody();
        rows.forEach(row => {
            const tr = tbody.insertRow();
            row.forEach(columnValue => {
                const td = tr.insertCell();
                td.textContent = columnValue;
            });
        });
        
        container.replaceChildren(table);
    }

    function renderNavMenu() {
        const nav = document.querySelector('header nav');
        Object.keys(globalThis.queries).forEach(queryName => {
            const hyperlink = document.createElement('a');
            hyperlink.textContent = queryName;
            hyperlink.href = `?query=${queryName}`;
            nav.appendChild(hyperlink);
        });

        const result = runQuery('SELECT id, scenario_name, win FROM session');
        result.rows.forEach(row => {
            const hyperlink = document.createElement('a');
            const sessionId = row[0];
            const scenario = row[1];
            const outcome = row[2] == 1 ? 'Win' : 'Loss';
            hyperlink.textContent = `${sessionId} ${scenario} ${outcome}`;
            hyperlink.href = `?query=${sessionStatsQueryName}_${sessionId}`;
            nav.appendChild(hyperlink);
        });
    }

    const stathaven = function(sqlite3) {
        try {
            renderNavMenu();

            const queryName = getQueryNameInUrl();
            if (!queryName) {
                queryName = globalThis.queries.keys()[0];
            }
            runNamedQuery(queryName);
        } finally {
            // TODO: handle this properly
            // if (globalThis.db)
            //     globalThis.db.close();
        }
    };

    const load = function(sqlite3) {
        const dbUrl = '/stathaven.db';
        fetch(dbUrl)
            .then(res => res.arrayBuffer())
            .then(function(arrayBuffer) {
                const mem = sqlite3.wasm.allocFromTypedArray(arrayBuffer);
                const db = new sqlite3.oo1.DB();
                const rc = sqlite3.capi.sqlite3_deserialize(
                    db.pointer,
                    'main',
                    mem,
                    arrayBuffer.byteLength,
                    arrayBuffer.byteLength,
                    // This is read-only, so if we ever need write capabilities, add: `| sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE`
                    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE
                );
                db.checkRc(rc);
                if (db) {
                    globalThis.db = db;
                    stathaven(sqlite3);
                } else {
                    throw new Error('Database failed to initialize');
                }
            })
            .catch(err => console.error('Unexpected error:', err));
    };

    window.sqlite3InitModule().then(function(sqlite3) {
        try {
            load(sqlite3);
        } catch (err) {
            console.error("Sqlite3 failed to load:", err.message);
        }
    });
})();