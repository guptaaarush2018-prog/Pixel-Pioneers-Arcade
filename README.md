# Pixel Pioneers Arcade

Browser games for students, hosted on GitHub Pages. Plain HTML, CSS, and JavaScript: no build step, no dependencies. Open `index.html` straight from disk or serve the folder.

## Games

| Game | Genre | Online |
| --- | --- | --- |
| Stickman Evolution: The 95th | Fighting | Linked from the hub; hosted at [pixel-pioneers-studios.github.io/Stickman-Battles](https://pixel-pioneers-studios.github.io/Stickman-Battles/) |
| Paintball Arena | Fighting (platform shooter) | Linked from the hub; hosted at [plzgimmeaname.github.io/paintball-web](https://plzgimmeaname.github.io/paintball-web/) |
| Pixel Pitch | Sports (4-a-side football, knockout Cup with golden goal) | Live 1v1 |
| Hoop Duel | Sports (1v1 basketball, On Fire streaks) | Live 1v1 |
| Pixel Gridiron | Sports (top-down football, season mode, play cards with route diagrams) | Online duel |
| Ice Clash | Sports (3-on-3 hockey with goalies, slapshots, sudden-death overtime) | Online duel |
| Apex GP | Racing (pseudo-3D Grand Prix: 8 circuits, slipstream, tyre wear, pit stops, championship) | Online duel |
| Grand Slam | Sports (arcade baseball: pitch selection, timed swings, fielding plays) | Online duel |
| Putt Planet | Sports (space mini golf, 12 holes) | Online duel |
| Light Trail | Arcade (trail duel, shrinking arena) | Live 1v1, two on one keyboard |
| Quick Draw | Arcade (reaction standoff, outlaw ladder) | Live 1v1, two on one keyboard |
| Buzz Bout | Trivia (700+ questions plus generated math, category draft, final wager, Streak and Daily 10; some questions from the [Open Trivia Database](https://opentdb.com), CC BY-SA 4.0) | Live 1v1, two on one device |
| Beat Lane | Rhythm (four lanes, four synthesized songs, three difficulties) | Online duel |
| Pocket Racer | Racing | Its own mini-site: six-cup career with stars, 38 tracks, garage of 17 unlockable cars, time trials with per-track world leaderboards, track builder, synthesized engine sound and music, follow camera on phones, live 1v1 races, world-record ghost |
| Rune Rumble | Strategy (lane battler: 42 cards, rune wells, decks, caches, ladder) | Live 1v1 |
| Realm Rivals | Strategy (kingdom builder) | Live 1v1 kingdom wars, plus the long-term Kingdom mode |
| Rampart | Strategy (tower defense where you build the maze) | Online duel |
| Dice Delve | Strategy (dice roguelike, three acts, daily seeded run) | Online duel |
| Box Battle | Strategy | Live 1v1 |
| Gravity Four | Strategy (four in a row with a board tilt) | Live 1v1 |
| Mega Tac-Toe | Strategy (nine-board tic-tac-toe) | Live 1v1 |
| Fleet Hunt | Strategy (hidden fleets, sonar, airstrikes) | Live 1v1 |
| Chess | Strategy (classic, or Crystal chess with level-ups) | Live 1v1 |
| Taco Truck Tycoon | Tycoon (five spots, weekday crowds, four-item menu, rivals and critics, endless mode) | Online duel |
| Timber Haul | Tycoon (drive-and-saw logging truck, stacking loads, garage upgrades, crew trucks, five forests, lucky trees, mill orders) | Leaderboard |
| Sweet Works | Idle (merge matching candy machines, conveyor shipping, 20 sweets to discover, upgrades, auto-merger, franchises) | Leaderboard |
| Gem Mine | Idle (six layers to breach, ore refinery, Lab research, abilities, drill bits, expeditions, relics, Core tree, challenge dives) | Leaderboard |
| Pocket Pet | Idle (virtual pet, earns treats from other games) | Leaderboard |
| Crowd Rush | Arcade (gate runner) | Online duel |
| Lane Rush | Racing | Online duel |
| Neon Noodle | Arcade (snake) | Online duel |
| Block Bloom | Puzzle (block placement: clear rows and columns, combos, gem blocks that earn shuffles) | Online duel |
| Crystal Swap | Puzzle (match-3) | Online duel |
| Sudoku Siege | Puzzle (sudoku, races with fog) | Live 1v1 race |
| Pixel Reveal | Puzzle (picture logic, gallery) | Online duel |
| Lantern Maze | Maze chase | Online duel |
| Brick Burst | Arcade (brick breaker) | Online duel |
| Comet Pinball | Arcade (pinball) | Online duel |
| Type Storm | Typing | Online duel |
| Letter Lock | Word (chained five-letter guessing) | Online duel |
| Cloud Climber | Platformer | Online duel |
| Stack Up | Arcade (one button) | Online duel |
| Nova Barrage | Shooter (bullet hell: five sectors with bosses, grazing multiplier, upgrade picks, endless loops) | Online duel |
| Polarity Run | Runner (rule-changing zones: polarity gates, saws, low gravity, Overdrive; air flips, combos, power-ups, skins) | Online duel |
| Blackjack | Cards | Leaderboard |
| Video Poker | Cards | Leaderboard |
| High-Low | Cards | Leaderboard |
| Peak Run | Cards (tri-peaks solitaire with combos) | Leaderboard |

Every game also feeds the shared **profile**: playtime, games finished, days played, and achievements (arcade-wide, plus Bronze/Silver/Gold medals and specials for each game). All of that lives in the player's browser and works without any setup.

Games that want more polish than flat shapes can load [`assets/js/gfx.js`](assets/js/gfx.js) after `arcade.js`: colour shading, soft shadows, fake-3D boxes and extruded vehicles, outlined text, HUD cards and bars, particles, floating "+$" popups, screen shake, easing and pre-rendered sprites. Timber Haul and Sweet Works are built on it, and Taco Truck Tycoon uses it for its scenery. Its effects never call `Math.random`, so they're safe in online duels.

The four card tables share one wallet of pretend chips (`ppa:chips` in localStorage). Chips can't be bought; anyone who runs out is given a fresh stack. A table's score is the most chips held during a session.

## Social and rewards

- **Tickets and prize shop.** Every finished game pays a ticket, plus one per medal score reached. Tickets buy cosmetics on the Profile page (chess boards, Rune Rumble team colours, Gem Mine sparkles); a game reads its slot with `Arcade.equipped(slot)`. Items live in `Arcade.SHOP` in [`assets/js/arcade.js`](assets/js/arcade.js).
- **Daily challenges.** Three a day (one score, one win, one general), the same for everyone, picked from the date. +5 tickets each, +5 for all three. Shown on the hub and Profile.
- **Chat** ([`chat.js`](assets/js/chat.js)). One arcade-wide room. Messages go through [`filter.js`](assets/js/filter.js) before sending and again when shown; links, emails and phone numbers are blocked. It only streams while open, and anyone may delete messages over a day old.
- **Friends and nicknames** ([`friends.js`](assets/js/friends.js)). Kept in the browser, keyed by player id. Add friends by friend code (on Profile), from chat, or from Recent players (anyone you met in a live match). Nicknames are private and replace names in chat, the lobby, leaderboards and match screens.
- **Challenges** ([`invites.js`](assets/js/invites.js)). Pick an online friend and a game; both of you land in the same 4-letter room. Only invites from your friends are shown, and they last two minutes.
- **Quick chat.** During any live match, a row of preset messages (GG!, Nice one!, …). Built into [`relay.js`](assets/js/relay.js), so every live game gets it.

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
5. Paste it into [`assets/js/config.js`](assets/js/config.js) as `firebaseUrl`.
6. **Build → Authentication → Get started**, then on **Sign-in method** turn on **Anonymous** and **Email/Password**.
7. **Project settings → General → Your apps → Add app → Web**. From the config it shows, copy only `apiKey` into `config.js` as `firebaseApiKey` (the rest is for Firebase's SDK, which this site doesn't use). Commit and push.

That turns on player accounts, global leaderboards, the "playing now" counters (site-wide and per game), the **Lobby** page, chat, friend status and challenges, Pocket Racer ghosts, and real players in Realm Rivals' Kingdom mode. Leave `firebaseUrl` empty and everything else keeps working, including every live match and duel below.

## Real-time matches and duels

Live matches don't use Firebase. They connect to the Socket.io relay that Stickman Evolution: The 95th already runs on Render (the Stickman-Battles repo) (`relayUrl` in [`assets/js/config.js`](assets/js/config.js)); that server's `ALLOWED_ORIGINS`/`PORTAL_ORIGINS` already include this site's GitHub Pages origin. [`assets/js/relay.js`](assets/js/relay.js) speaks the Socket.io wire format over a plain WebSocket, so there's still no SDK.

- The relay pairs two players per room name and forwards their messages. In real-time games (Pixel Pitch, Hoop Duel, Rune Rumble) the player who arrived first runs the match and streams snapshots; the other sends inputs. Pocket Racer players each drive their own car and stream position and speed; the other car is drawn slightly ahead of its last update to hide the delay, and the host times a ping before the race so both countdowns end together. Box Battle and Realm Rivals send moves and attacks as events.
- Gravity Four, Mega Tac-Toe, Fleet Hunt, Chess, Light Trail and Quick Draw share their menus, rooms and rematches through [`assets/js/match.js`](assets/js/match.js). In the turn-based ones both players run the same rules and send their own moves; Fleet Hunt keeps each fleet on its owner's device and answers shots with hit or miss. Light Trail's host runs the bikes, and Quick Draw times each player's reaction on their own screen so lag doesn't decide a round.
- Sudoku Siege's host makes the puzzle and decides who finished first; progress and fog go back and forth as events.
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

### Accounts

[`assets/js/online.js`](assets/js/online.js) talks to Firebase Authentication over its REST API (still no SDK).

- **Guests.** Every visitor gets an anonymous account on their first visit, with nothing to fill in. Every database write is signed with that account's token.
- **Saving an account.** On the Profile page a guest can add an email and password. The account and its id stay the same, and progress (everything the arcade keeps in `localStorage` except race ghosts) is backed up to `profiles/<id>`.
- **Logging in** on another browser or device restores that backup. A saved account that played on another device picks up the newer backup on its next page load, keeping the higher of each best score. **Forgot password?** sends Firebase's reset email.
- **Friend codes** are the short codes players share. `codes/<code>` points at the account. Players from before accounts existed keep their old id as their friend code. On their first visit after the update, their leaderboard entries and Kingdom under the old id move to the account, and friend lists swap old codes for accounts as players return.
- **Names are unique.** `names/<name>` records who holds each name, and `profiles/<id>/name` is the player's current one.

What the rules enforce:
- Players can only write their own entries (`auth.uid` must match), and every name, chat id, invite sender and battle report sender must be the writer's own.
- Leaderboard entries can only go up, and names must match the generated `AdjectiveNoun00` format, so nobody can post a custom (possibly rude) name.
- Ghosts can only be replaced by a faster time.
- Another player can only touch your Kingdom's raid shield (capped at about 2 hours). Lobby entries must point at a public queue room. Kingdom snapshots and battle reports are shape-checked and losses are capped.
- Backups in `profiles/<id>` are readable only by their owner.

Scores are still reported by each browser, so a determined player could post a fake score for their own account. For a casual arcade that's an accepted trade-off.

## Add a game

1. Create `games/<id>/` with an `index.html` (copy one from another game and set `data-game="<id>"` on `<body>`), a `game.js`, and a 16:10 `thumb.svg`. (A game hosted elsewhere only needs a catalog entry with `url`, `thumb` and `by`.)
2. Add an entry to [`assets/js/catalog.js`](assets/js/catalog.js) with a title, genre, description, and three medal `goals`.
3. In `game.js`, end each run with `Arcade.finish(ui, { score, onAction: start })`. That saves the best score, counts the play, checks achievements, and posts to the global leaderboard.

Shared helpers live in [`assets/js/arcade.js`](assets/js/arcade.js) (canvas, input, overlay, sound, profile, achievements), [`assets/js/online.js`](assets/js/online.js) (leaderboards, presence, lobby, ghosts), [`assets/js/relay.js`](assets/js/relay.js) (real-time 1v1 over the relay), [`assets/js/versus.js`](assets/js/versus.js) (online score duels) and [`assets/js/cards.js`](assets/js/cards.js) (chip wallet and card drawing).

## Deploy

In the repo on GitHub, open Settings → Pages, choose "Deploy from a branch", and pick `main` / `(root)`.
