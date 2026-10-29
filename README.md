# Pixel Pioneers Arcade

Browser games for students, hosted on GitHub Pages. Plain HTML, CSS, and JavaScript: no build step, no dependencies. Open `index.html` straight from disk or serve the folder.

## Games

| Game | Genre | Online |
| --- | --- | --- |
| Rune Rumble | Strategy (real-time lane battler) | Live 1v1: quick match or room code |
| Realm Rivals | Strategy (kingdom builder) | Leaderboard |
| Taco Truck Tycoon | Tycoon | Leaderboard |
| Gem Mine | Idle | Leaderboard |
| Crowd Rush | Arcade (gate runner) | Leaderboard |
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

Every game also feeds the shared **profile**: playtime, games finished, days played, and 73 achievements (12 arcade-wide, plus Bronze/Silver/Gold medals and specials for each game). All of that lives in the player's browser and works without any setup.

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

## Real-time matches (Rune Rumble)

Rune Rumble's online mode doesn't use Firebase. It connects to the Socket.io relay that Stickman Battles already runs on Render (`relayUrl` in [`assets/js/config.js`](assets/js/config.js)); that server's `ALLOWED_ORIGINS`/`PORTAL_ORIGINS` already include this site's GitHub Pages origin. [`assets/js/relay.js`](assets/js/relay.js) speaks the Socket.io wire format over a plain WebSocket, so there's still no SDK.

- The relay pairs two players per room name and forwards their messages. The player who arrived first runs the match and streams snapshots; the other sends card plays.
- **Quick match** takes the first free public room (`pp-rune-q1`, `q2`, …). **Private rooms** use a 4-letter code.
- The relay sleeps when idle on Render's free plan, so the first connection can take up to a minute.
- Relay rooms hold two players. A game for more players (such as a social deduction game) would need a bigger room type on the Stickman Battles server.

What the rules enforce:
- Leaderboard entries can only go up, and names must match the generated `AdjectiveNoun00` format, so nobody can post a custom (possibly rude) name.
- Ghosts can only be replaced by a faster time.
- Rooms use 4-letter codes, and moves are validated.

There's no login, so a determined student could still post a fake score through the API. If that becomes a problem, the next step is Firebase Anonymous Auth.

## Add a game

1. Create `games/<id>/` with an `index.html` (copy one from another game and set `data-game="<id>"` on `<body>`), a `game.js`, and a 16:10 `thumb.svg`.
2. Add an entry to [`assets/js/catalog.js`](assets/js/catalog.js) with a title, genre, description, and three medal `goals`.
3. In `game.js`, end each run with `Arcade.finish(ui, { score, onAction: start })`. That saves the best score, counts the play, checks achievements, and posts to the global leaderboard.

Shared helpers live in [`assets/js/arcade.js`](assets/js/arcade.js) (canvas, input, overlay, sound, profile, achievements), [`assets/js/online.js`](assets/js/online.js) (leaderboards, presence, rooms, ghosts) and [`assets/js/relay.js`](assets/js/relay.js) (real-time 1v1 over the relay).

## Deploy

In the repo on GitHub, open Settings → Pages, choose "Deploy from a branch", and pick `main` / `(root)`.
