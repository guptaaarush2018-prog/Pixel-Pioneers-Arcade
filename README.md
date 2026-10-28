# Pixel Pioneers Arcade

Browser games for students, hosted on GitHub Pages. Plain HTML, CSS, and JavaScript: no build step, no dependencies. Open `index.html` straight from disk or serve the folder.

## Games

| Game | Genre | Online |
| --- | --- | --- |
| Pocket Racer | Racing | Ghost of the world's fastest racer |
| Lane Rush | Racing | Leaderboard |
| Box Battle | Strategy | Live matches with room codes |
| Neon Noodle | Arcade (snake) | Leaderboard |
| Crystal Swap | Puzzle (match-3) | Leaderboard |
| Lantern Maze | Maze chase | Leaderboard |
| Brick Burst | Arcade (brick breaker) | Leaderboard |
| Type Storm | Typing | Leaderboard |
| Cloud Climber | Platformer | Leaderboard |
| Stack Up | Arcade (one button) | Leaderboard |
| Polarity Run | Runner | Leaderboard |

Every game also feeds the shared **profile**: playtime, games finished, days played, and 48 achievements (12 arcade-wide, plus Bronze/Silver/Gold medals and specials for each game). All of that lives in the player's browser and works without any setup.

## Run locally

Open `index.html` in a browser, or:

```sh
python3 -m http.server 8000
```

## Turn on online features (optional)

GitHub Pages only serves static files, so online features talk directly from the browser to a free Firebase Realtime Database. There's no server of your own and no SDK; the site uses Firebase's plain web API.

1. Go to https://console.firebase.google.com, create a project (Analytics can stay off).
2. **Build → Realtime Database → Create database**. Pick a location, start in **locked mode**.
3. On the **Rules** tab, paste the contents of [`database.rules.json`](database.rules.json) and click **Publish**.
4. Copy the database URL shown at the top of the **Data** tab (it looks like `https://your-project-default-rtdb.firebaseio.com`).
5. Paste it into [`assets/js/config.js`](assets/js/config.js) as `firebaseUrl`, then commit and push.

That turns on global leaderboards, the "playing now" counter, Pocket Racer ghosts, and Box Battle online rooms. Leave `firebaseUrl` empty and everything else keeps working offline.

What the rules enforce:
- Leaderboard entries can only go up, and names must match the generated `AdjectiveNoun00` format, so nobody can post a custom (possibly rude) name.
- Ghosts can only be replaced by a faster time.
- Rooms use 4-letter codes, and moves are validated.

There's no login, so a determined student could still post a fake score through the API. If that becomes a problem, the next step is Firebase Anonymous Auth.

## Add a game

1. Create `games/<id>/` with an `index.html` (copy one from another game and set `data-game="<id>"` on `<body>`), a `game.js`, and a 16:10 `thumb.svg`.
2. Add an entry to [`assets/js/catalog.js`](assets/js/catalog.js) with a title, genre, description, and three medal `goals`.
3. In `game.js`, end each run with `Arcade.finish(ui, { score, onAction: start })`. That saves the best score, counts the play, checks achievements, and posts to the global leaderboard.

Shared helpers live in [`assets/js/arcade.js`](assets/js/arcade.js) (canvas, input, overlay, sound, profile, achievements) and [`assets/js/online.js`](assets/js/online.js) (leaderboards, presence, rooms, ghosts).

## Deploy

In the repo on GitHub, open Settings → Pages, choose "Deploy from a branch", and pick `main` / `(root)`.
