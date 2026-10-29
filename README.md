# Pixel Pioneers Arcade

Browser games for students, hosted on GitHub Pages. Plain HTML, CSS, and JavaScript: no build step, no dependencies. Open `index.html` straight from disk or serve the folder.

## Games

| Game | Genre | Online |
| --- | --- | --- |
| Stickman Evolution: The 95th | Fighting | Linked from the hub; hosted at [pixel-pioneers-studios.github.io/Stickman-Battles](https://pixel-pioneers-studios.github.io/Stickman-Battles/) |
| Pixel Pitch | Sports (4-a-side football) | Live 1v1 |
| Hoop Duel | Sports (1v1 basketball) | Live 1v1 |
| Pocket Racer | Racing | Live 1v1 races, world-record ghost |
| Rune Rumble | Strategy (real-time lane battler) | Live 1v1 |
| Realm Rivals | Strategy (kingdom builder) | Live 1v1 kingdom wars, plus the long-term Kingdom mode |
| Box Battle | Strategy | Live 1v1 |
| Taco Truck Tycoon | Tycoon | Online duel |
| Gem Mine | Idle | Leaderboard |
| Crowd Rush | Arcade (gate runner) | Online duel |
| Lane Rush | Racing | Online duel |
| Neon Noodle | Arcade (snake) | Online duel |
| Crystal Swap | Puzzle (match-3) | Online duel |
| Lantern Maze | Maze chase | Online duel |
| Brick Burst | Arcade (brick breaker) | Online duel |
| Type Storm | Typing | Online duel |
| Cloud Climber | Platformer | Online duel |
| Stack Up | Arcade (one button) | Online duel |
| Polarity Run | Runner | Online duel |
| Blackjack | Cards | Leaderboard |
| Video Poker | Cards | Leaderboard |
| High-Low | Cards | Leaderboard |

Every game also feeds the shared **profile**: playtime, games finished, days played, and achievements (arcade-wide, plus Bronze/Silver/Gold medals and specials for each game). All of that lives in the player's browser and works without any setup.

The three card tables share one wallet of pretend chips (`ppa:chips` in localStorage). Chips can't be bought; anyone who runs out is given a fresh stack. A table's score is the most chips held during a session.

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

That turns on global leaderboards, the "playing now" counters (site-wide and per game), the **Lobby** page, Pocket Racer ghosts, and real players in Realm Rivals' Kingdom mode. Leave `firebaseUrl` empty and everything else keeps working, including every live match and duel below.

## Real-time matches and duels

Live matches don't use Firebase. They connect to the Socket.io relay that Stickman Evolution: The 95th already runs on Render (the Stickman-Battles repo) (`relayUrl` in [`assets/js/config.js`](assets/js/config.js)); that server's `ALLOWED_ORIGINS`/`PORTAL_ORIGINS` already include this site's GitHub Pages origin. [`assets/js/relay.js`](assets/js/relay.js) speaks the Socket.io wire format over a plain WebSocket, so there's still no SDK.

- The relay pairs two players per room name and forwards their messages. In real-time games (Pixel Pitch, Hoop Duel, Rune Rumble) the player who arrived first runs the match and streams snapshots; the other sends inputs. Pocket Racer players each drive their own car and stream positions. Box Battle and Realm Rivals send moves and attacks as events.
- **Quick match** takes the first free public room (`pp-<game>-q1`, `q2`, …). **Private rooms** use a 4-letter code.
- **Online duels** ([`assets/js/versus.js`](assets/js/versus.js)) turn any single-player game into a live score race: both players start at the same moment with the same random seed, see each other's score, and the higher final score wins. A game opts in by showing its start panel through `Versus.attach({ ui, start, score, intro })`.
- The relay sleeps when idle on Render's free plan, so the first connection can take up to a minute.
- Relay rooms hold two players. A game for more players would need a bigger room type on that server.

### Lobby

While someone waits alone in a public quick-match room, relay.js lists them under `lobby/<playerId>` in Firebase (refreshed every 20 seconds, removed when matched or gone). The [Lobby](lobby.html) page shows everyone waiting across the arcade with a Join button, and each game's online menu shows who's waiting for that game. Joining links to `games/<id>/index.html?join=<room>`, which drops you straight into their room. Private rooms are never listed.

## Realm Rivals: Kingdom (long-term mode)

[`games/realm-rivals/kingdom.html`](games/realm-rivals/kingdom.html) is a city builder to come back to. Upgrades and training run on real timers and keep going while the tab is closed (the game replays everything that happened since your last visit when you return). There are bandit camps to raid and bot kingdoms that grow over time and raid you back once your keep reaches level 3, with a beginner's peace shield until keep level 4 (or three days).

With Firebase on, real players share the world, with no game server needed:
- Each kingdom publishes a snapshot to `kingdoms/<id>`: power, defenders, wall, and how much of its stores can be looted.
- When an army arrives at a real player, the attacker's game fetches that snapshot, fights the battle, and posts a report to `kinbox/<id>`. The defender's game applies the losses next time it checks (every 30 seconds while open, and on load).
- A sacked kingdom gets a 2-hour peace shield.

Because there's no server of its own, each browser is trusted to report its own kingdom honestly, the same trade-off as the leaderboards. If cheating becomes a problem, the fix is a small server (or Firebase Cloud Functions) that owns kingdom state and resolves battles.

What the rules enforce:
- Leaderboard entries can only go up, and names must match the generated `AdjectiveNoun00` format, so nobody can post a custom (possibly rude) name.
- Ghosts can only be replaced by a faster time.
- Lobby entries must point at a public queue room; Kingdom snapshots and battle reports are shape-checked and losses are capped.

There's no login, so a determined student could still post a fake score through the API. If that becomes a problem, the next step is Firebase Anonymous Auth.

## Add a game

1. Create `games/<id>/` with an `index.html` (copy one from another game and set `data-game="<id>"` on `<body>`), a `game.js`, and a 16:10 `thumb.svg`. (A game hosted elsewhere only needs a catalog entry with `url`, `thumb` and `by`.)
2. Add an entry to [`assets/js/catalog.js`](assets/js/catalog.js) with a title, genre, description, and three medal `goals`.
3. In `game.js`, end each run with `Arcade.finish(ui, { score, onAction: start })`. That saves the best score, counts the play, checks achievements, and posts to the global leaderboard.

Shared helpers live in [`assets/js/arcade.js`](assets/js/arcade.js) (canvas, input, overlay, sound, profile, achievements), [`assets/js/online.js`](assets/js/online.js) (leaderboards, presence, lobby, ghosts), [`assets/js/relay.js`](assets/js/relay.js) (real-time 1v1 over the relay), [`assets/js/versus.js`](assets/js/versus.js) (online score duels) and [`assets/js/cards.js`](assets/js/cards.js) (chip wallet and card drawing).

## Deploy

In the repo on GitHub, open Settings → Pages, choose "Deploy from a branch", and pick `main` / `(root)`.
