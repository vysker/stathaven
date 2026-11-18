# Stathaven

A simple web app to present Frosthaven scenario stats of my group's playthrough.

## Tech

This web app is powered by plain `html`, `js` and `sqlite3 wasm js`.

The sqlite3 database is fetched when the app starts, so all data is located in-memory on the client side. This makes it possible to support dynamic queries, including sorting, without a backend.

The philosophy here is to have as little moving parts as possible, so the app can be hosted anywhere and doesn't require any complex build processes or dependency management.

## Data

The data is based on the scenario stats screen you see when you finish a scenario in the digital version of Frosthaven.

This data is entered manually and added as a `.csv` file to `data/`. By running `ingest.py`, the data is included in the `stathaven.db`, which is the sqlite3 database. Characters have to be edited manually in `characters.sql`.
