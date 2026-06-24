# Friend Group Elo Ranking

A simple web app for tracking a friend group's Elo-based rankings, match results, head-to-head records, and rating history.

## Features

- Elo rating system for player ranking
- Win/loss tracking and head-to-head stats
- Dynamic ranking table with live updates
- Match submission form for recording game outcomes
- Profile pages with current rank, win rate, and rating history graph
- SQLite-backed data persistence

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the app:

   ```bash
   npm start
   ```

3. Open your browser at `http://localhost:3000`.

## Project Structure

- `src/server.js` — Express server and API routes
- `src/db.js` — SQLite initialization and Elo logic
- `public/` — static frontend assets
- `.github/copilot-instructions.md` — setup checklist

## Notes

- The app seeds sample players on first run.
- Use the match form to submit outcomes and instantly refresh the ranking table.
- Open `profile.html?playerId=1` to view an individual player profile.
