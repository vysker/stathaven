'use strict';
(function() {
    const RESULT_CONTAINER = '#result';
    const VIEW_KEY = 'view';
    const SESSION_KEY = 'sessionId';
    
    globalThis.characterNameToIconPath = {}; // E.g. 'Boneshaper' -> './assets/boneshaper.png'

    // E.g. new Sort('damage_done' -> 'desc')
    class Sort {
        constructor(column, direction) {
            this.column = column;
            this.direction = direction;
        }
    }
    
    class State {
        constructor(view, sorts, sessionId) {
            this.view = view; // Views
            this.sorts = sorts; // Array<Sort>
            this.sessionId = sessionId; // Only relevant when Views.SESSION is active
        }
    }

    const Views = Object.freeze({
        SESSION: {
            title: 'Scenario',
            alias: 'session',
            description: 'Detailed scenario stats',
            sql: `SELECT
                    character_name AS character,
                    level AS lvl,
                    -- trophies,
                    enemies_killed AS kills,
                    damage_done AS dmg_done,
                    damage_taken AS dmg_taken,
                    healing_done AS healed,
                    loot_collected AS loot_bags,
                    chests_looted AS chests,
                    ability_xp_earned AS card_xp
                FROM session_stats_enriched`,
        },
        CHARACTER_STATS: {
            title: 'Character',
            alias: 'character',
            description: 'Campaign-spanning character stats',
            sql: 'SELECT * FROM basic_character_stats',
        },
        BEST_BUDDIES: {
            title: 'Best Buddies',
            alias: 'buddies',
            description: 'Shows the characters that played together most',
            sql: 'SELECT * FROM best_buddies',
        },
        MEDIAN_DAMAGE: {
            title: 'Median Damage',
            alias: 'median_damage',
            description: 'Character median damage across the whole campaign',
            sql: 'SELECT name AS character, median_damage_done FROM median_damage'
        },
    });

    let state = new State(
        Views.SESSION.alias, // view
        [],                  // sorts
        1,                   // sessionId
    );

    function setState(newState) {
        state = newState;

        const url = new URL(window.location);
        url.searchParams.keys().forEach(key => url.searchParams.delete(key));

        state.sorts.forEach(sort => url.searchParams.set(sort.column, sort.direction));
        if (state.view)      url.searchParams.set(VIEW_KEY, state.view.alias);
        if (state.sessionId) url.searchParams.set(SESSION_KEY, state.sessionId);

        history.pushState(null, '', url);
        reflectState();
    }

    function getViewByAlias(alias) {
        if (alias) {
            for (const key in Views) {
                const view = Views[key];
                if (view.alias === alias) {
                    return view;
                }
            }
        }
        return null;
    }

    globalThis.cycleSort = function(columnName) {
        const sort = state.sorts.findLast(s => s.column === columnName);
        const direction = sort ? sort.direction : null;
        let newDirection;
        switch (direction) {
            case null:   newDirection = 'asc'; break;
            case 'asc':  newDirection = 'desc'; break;
            case 'desc': newDirection = null; break;
        }

        const sorts = state.sorts.filter(s => s.column !== columnName);
        if (newDirection) {
            sorts.push(new Sort(columnName, newDirection));
        }
        setState(new State(state.view, sorts, state.sessionId));
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

    function parseStateFromUrl() {
        const url = new URL(window.location);
        const sessionIdInUrl = url.searchParams.get(SESSION_KEY);
        const viewInUrl = getViewByAlias(url.searchParams.get(VIEW_KEY));

        const view = viewInUrl ? viewInUrl : Views.SESSION;
        const sessionId = sessionIdInUrl ? parseInt(sessionIdInUrl) : 1;
        const sorts = [];

        url.searchParams.forEach((value, column) => {
            if (column !== VIEW_KEY && column !== SESSION_KEY) {
                sorts.push(new Sort(column, value));
            }
        });

        return new State(view, sorts, sessionId);
    }

    function makeOrderByClause(sorts) {
        const orderByClause = sorts.map(s => `${s.column} ${s.direction}`).join(', ');
        if (orderByClause.length > 0) {
            return ' ORDER BY ' + orderByClause;
        } else {
            return '';
        }
    }

    function getSessionCount() {
        return runQuery('SELECT count(id) FROM session').rows[0][0];
    }

    function wrapSessionId(sessionId) {
        const sessionCount = getSessionCount();
        if (sessionId < 1) sessionId = sessionCount;
        if (sessionId > sessionCount) sessionId = 1;
        return sessionId;
    }

    globalThis.clearSorts = function() {
        setState(new State(state.view, [], state.sessionId));
    };

    globalThis.nextSession = function() {
        let sessionId = wrapSessionId(state.sessionId + 1);
        setState(new State(state.view, state.sorts, sessionId));
    };

    globalThis.prevSession = function() {
        let sessionId = wrapSessionId(state.sessionId - 1);
        setState(new State(state.view, state.sorts, sessionId));
    };

    globalThis.setSession = function(sessionId) {
        sessionId = wrapSessionId(sessionId);
        setState(new State(Views.SESSION, [], sessionId));
    };

    globalThis.setView = function(alias) {
        const view = getViewByAlias(alias);
        if (view) {
            setState(new State(view, state.sorts, state.sessionId));
        }
    };

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

    function updateHeader() {
        const viewTitle = document.getElementById('view-title');

        if (state.view === Views.SESSION) {
            const sessionId = state.sessionId;
            const sessionInfo = runQuery(`SELECT scenario_name, win FROM session WHERE id = ${sessionId}`).rows[0];
            const outcomeText = sessionInfo[1] == 1 ? 'Victory' : 'Defeat';
            viewTitle.textContent = `Session #${sessionId}: ${sessionInfo[0]} (${outcomeText})`;
        } else {
            viewTitle.textContent = state.view.title;
        }
    }

    function reflectState() {
        let sql = state.view.sql;
        if (state.view === Views.SESSION) {
            sql += ' WHERE session_id = ' + state.sessionId;
        }
        sql += makeOrderByClause(state.sorts);
        const result = runQuery(sql);

        renderQueryResult(result.columnNames, result.rows);
        updateHeader();
    }

    function renderQueryResult(columnNames, rows) {
        const container = document.querySelector(RESULT_CONTAINER);
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
            row.forEach((columnValue, columnIndex) => {
                const columnName = columnNames[columnIndex];

                const td = tr.insertCell();
                td.classList.add(columnName);

                const span = document.createElement('span');
                span.textContent = columnValue;

                if (columnValue > 0 && columnValue === columnBests[columnIndex]) {
                    span.classList.add('best');
                }

                let cellContent = span;
                if (typeof(columnValue) === 'string') {
                    const iconPath = globalThis.characterNameToIconPath[columnValue];
                    if (iconPath) {
                        const div = document.createElement('div');
                        const img = document.createElement('img');
                        div.classList.add('character-icon-parent');
                        img.classList.add('character-icon');
                        img.src = iconPath;
                        div.appendChild(img);
                        div.appendChild(span);
                        cellContent = div;
                    }
                }

                td.appendChild(cellContent);
            });
        });

        container.replaceChildren(table);

        const cycleButtons = document.querySelectorAll('.session-cycle-button');
        if (state.view == Views.SESSION) {
            cycleButtons.forEach(btn => btn.classList.add('show'));
        } else {
            cycleButtons.forEach(btn => btn.classList.remove('show'));
        }
    }

    function renderNavMenu() {
        const namedQueriesNav = document.querySelector('nav#named-queries');
        for (const key in Views) {
            const view = Views[key];
            if (view === Views.SESSION)
                continue;
            const button = document.createElement('button');
            button.setAttribute('onclick', `setView('${view.alias}')`);
            button.textContent = view.title;
            button.alt = view.description;
            namedQueriesNav.appendChild(button);
        }

        const sessionListNav = document.querySelector('nav#session-list');
        const result = runQuery('SELECT id, scenario_name, win FROM session');
        result.rows.forEach(row => {
            const hyperlink = document.createElement('button');
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
            hyperlink.setAttribute('onclick', `setSession(${sessionId})`);
            sessionListNav.appendChild(hyperlink);
        });

        if (window.screen.width < 800) {
            document.querySelector('details.rankings-accordion').removeAttribute('open');
            document.querySelector('details.session-accordion').removeAttribute('open');
        }
    }

    const stathaven = function() {
        const result = runQuery(`SELECT DISTINCT name, icon_path FROM character`);
        result.rows.forEach(row => globalThis.characterNameToIconPath[row[0]] = './assets/' + row[1]);

        renderNavMenu();
        const state = parseStateFromUrl();
        setState(state);
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
                    stathaven();
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