'use strict';
(function() {
    const resultContainer = '#result';
    const urlQueryKey = 'query';
    const sessionStatsQueryName = 'sessionStats';

    globalThis.queries = {
        sessionStats:
            `SELECT
                -- CONCAT(ch.name, '(', ch.nickname, ')') AS character,
                ch.name as character,
                ss.enemies_killed,
                ss.damage_done,
                ss.damage_taken,
                ss.healing_done,
                ss.loot_collected,
                ss.chests_looted,
                ss.ability_xp_earned,
                ss.items_used
            FROM session_stats ss
            JOIN character ch ON ch.id = ss.character_id`,
        basicCharacterStats:
            `SELECT
                -- CONCAT(c.name, ' (', c.nickname, ')') AS character,
                c.name as character,
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

    function formatQueryLabel(key) {
        return key
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }

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
    };

    function getSortCssClass(columnName) {
        const url = new URL(window.location);
        const value = url.searchParams.get(columnName);
        switch (value) {
            case 'asc':  return 'sort-asc';
            case 'desc': return 'sort-desc';
            default:     return 'sort-none';
        }
    }

    function getSortsFromUrl() {
        const url = new URL(window.location);
        const sorts = [];
        url.searchParams.forEach((value, key) => {
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
    };

    function getSessionIdFromQueryName(queryName) {
        return parseInt(queryName.split('_')[1], 10);
    }

    globalThis.nextSession = function() {
        const queryName = getQueryNameInUrl();
        const sessionCount = runQuery('SELECT count(id) FROM session').rows[0][0];
        let sessionId = getSessionIdFromQueryName(queryName);
        sessionId++;
        if (sessionId > sessionCount) {
            sessionId = 1;
        }
        runNamedQuery(sessionStatsQueryName + '_' + sessionId);
    };

    globalThis.prevSession = function() {
        const queryName = getQueryNameInUrl();
        const sessionCount = runQuery('SELECT count(id) FROM session').rows[0][0];
        let sessionId = getSessionIdFromQueryName(queryName);
        sessionId--;
        if (sessionId <= 0) {
            sessionId = sessionCount;
        }
        runNamedQuery(sessionStatsQueryName + '_' + sessionId);
    };

    function getQueryNameInUrl() {
        const url = new URL(window.location);
        return url.searchParams.get(urlQueryKey) || Object.keys(globalThis.queries)[0];
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

    function updateHeaderAndActiveNav(queryName) {
        const viewTitle = document.getElementById('view-title');

        document.querySelectorAll('aside.sidebar a').forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === `?query=${queryName}`);
        });

        if (queryName.startsWith(sessionStatsQueryName)) {
            const sessionId = getSessionIdFromQueryName(queryName);
            const sessionInfo = runQuery(`SELECT scenario_name, win FROM session WHERE id = ${sessionId}`).rows[0];
            if (sessionInfo) {
                const outcomeText = sessionInfo[1] == 1 ? 'Victory' : 'Defeat';
                viewTitle.textContent = `Session #${sessionId}: ${sessionInfo[0]} (${outcomeText})`;
            } else {
                viewTitle.textContent = `Session #${sessionId}`;
            }
        } else {
            viewTitle.textContent = formatQueryLabel(queryName);
        }
    }

    function runNamedQuery(queryName) {
        let sql;
        if (queryName.startsWith(sessionStatsQueryName)) {
            const sessionId = getSessionIdFromQueryName(queryName);
            const whereClause = ' WHERE session_id = ' + sessionId;
            sql = globalThis.queries[sessionStatsQueryName] + whereClause;
        } else {
            sql = globalThis.queries[queryName];
        }

        sql = sql + createOrderByClauseFromUrl();
        const result = runQuery(sql);

        const url = new URL(window.location);
        url.searchParams.set(urlQueryKey, queryName);
        history.pushState(null, '', url);

        updateHeaderAndActiveNav(queryName);
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
            th.classList.add(getSortCssClass(columnName));
            thead.appendChild(th);
        });

        const tbody = table.createTBody();
        const columnBests = [];
        if (rows.length > 0) {
            for (let col = 0; col < columnNames.length; col++) {
                const columnValues = rows.map(row => row[col]);
                const best = columnValues.reduce((prev, cur) => (cur > prev ? cur : prev));
                columnBests.push(best);
            }
        }

        rows.forEach(row => {
            const tr = tbody.insertRow();
            row.forEach((columnValue, col) => {
                const td = tr.insertCell();
                const span = document.createElement('span');
                span.textContent = columnValue;

                if (columnValue > 0 && columnValue === columnBests[col]) {
                    span.classList.add('best');
                }

                td.appendChild(span);
            });
        });

        container.replaceChildren(table);

        const cycleButtons = document.querySelector('.session-cycle-buttons');
        if (queryName.startsWith(sessionStatsQueryName)) {
            cycleButtons.classList.add('show');
        } else {
            cycleButtons.classList.remove('show');
        }
    }

    function renderNavMenu() {
        const namedQueriesNav = document.querySelector('nav#named-queries');
        Object.keys(globalThis.queries).forEach(queryName => {
            if (queryName.startsWith(sessionStatsQueryName))
                return;
            const hyperlink = document.createElement('a');
            hyperlink.textContent = formatQueryLabel(queryName);
            hyperlink.href = `?query=${queryName}`;
            namedQueriesNav.appendChild(hyperlink);
        });

        const sessionListNav = document.querySelector('nav#session-list');
        const result = runQuery('SELECT id, scenario_name, win FROM session');
        result.rows.forEach(row => {
            const hyperlink = document.createElement('a');
            const sessionIdNode = document.createElement('span');
            const scenarioNode = document.createElement('span');
            const outcomeNode = document.createElement('span');
            const sessionId = row[0];
            const scenario = row[1];
            const win = row[2];
            const outcome = win == 1 ? 'Win' : 'Loss';

            sessionIdNode.classList.add('session');
            sessionIdNode.textContent = sessionId;

            scenarioNode.classList.add('scenario');
            scenarioNode.textContent = scenario;

            outcomeNode.classList.add('outcome');
            if (win) outcomeNode.classList.add('win');
            outcomeNode.textContent = outcome;

            hyperlink.appendChild(sessionIdNode);
            hyperlink.appendChild(scenarioNode);
            hyperlink.appendChild(outcomeNode);
            hyperlink.href = `?query=${sessionStatsQueryName}_${sessionId}`;
            sessionListNav.appendChild(hyperlink);
        });
    }

    const stathaven = function(sqlite3) {
        renderNavMenu();

        let queryName = getQueryNameInUrl();
        if (!queryName) {
            queryName = Object.keys(globalThis.queries)[0];
        }
        runNamedQuery(queryName);
    };

    const load = function(sqlite3) {
        const dbUrl = `./stathaven.db?v=${Date.now()}`;
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