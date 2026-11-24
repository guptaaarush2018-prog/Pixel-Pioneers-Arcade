# Sovereign in the Arcade: neural boss opponents for Tankfield and Pocket Racer

Date: 2026-11-23 · Status: design, awaiting approval

## Intent

Two things at once:

1. **A new top-tier opponent for players.** "Sovereign" is a neural-network opponent that appears as a boss or a special mode in selected arcade games. Beating him earns achievements. He never appears on leaderboards and never counts as a player.
2. **A research testbed for adaptive AI.** The owner's Stickman-Battles game has a PPO + GRU fighter, also called Sovereign, that doesn't really adapt during a match. `Stickman-Battles/ADAPTATION_RESEARCH_PLAN.md` puts the main cause on training: he mostly trained against opponents who never changed how they played, so switching tactics rarely paid off. The arcade games are small and fast to simulate, so experiments that take days in Stickman-Battles take minutes here. The owner wants to study:
   - which strategies the network finds on its own;
   - whether it adapts within a match, and across matches;
   - how it keeps and uses information about its opponent.

   What's learned here should carry back to Stickman-Battles.

## Goals

- **Tankfield boss.** When the player's score (total XP) reaches 20,000, Sovereign spawns as a **level 45** tank. That's the level cap: the player has 33 stat points by then, and so does he. The network picks his turret path (level 10 and level 20 choices) and spends all 33 of his stat points. He fights with GRU memory that tracks the player during the fight. Normal rival tanks ignore the boss fight, so it stays a duel.
- **Pocket Racer, Sovereign Duel.** A new mode: player against Sovereign, best of 3 races on random built-in tracks. Both drive identical car stats. His GRU memory carries across all three races of a series, so habits seen in race 1 can be punished in race 3.
- **Pocket Racer, career final boss.** A one-race bonus event that unlocks after all 8 cups are cleared. It is optional: career completion, stars and existing progress don't change.
- **Achievements**, added through the existing `extras` mechanism in `assets/js/catalog.js` and `Arcade.flag()`:
  - Tankfield: beat Sovereign (name left to the builder).
  - Pocket Racer: **"Racing God"** for winning a Sovereign Duel series, plus a separate one for beating the career boss.
  - Arcade-wide: **"Sovereign Slayer"** for beating Sovereign in every game that has him. The list grows as games are added.
  - The game records which Sovereign version a win came against ("earned vs. v14").
- **Continuous learning from all players (owner's choice).** Every Sovereign match, win or loss, is recorded anonymously. The training lab periodically retrains on this data plus self-play, and new versions go live only after passing a promotion exam.
- **Research output.** Each training run writes a report:
  - which strategies emerged (build choices, engagement range, line choices, block and pass behaviour);
  - how much the GRU memory changes play mid-match;
  - performance with memory wiped or turned off;
  - performance against opponents that switch style mid-match.

  These metrics match the Stickman-Battles Sovereign notes, so the results compare directly.

## Non-goals

- A public multiplayer server with bots and players. The owner wants this later, as its own project.
- Sovereign in games other than Tankfield and Pocket Racer. The pipeline should make adding more games straightforward, but no other game is in scope.
- Leaderboard entries for Sovereign himself. He never appears as a player. (Killing him does pay normal kill XP into the player's score; see Game integration.)
- Teacher or class features. See the owner's standing preference: the arcade stays student-facing.
- Online (live relay) play against Sovereign. He runs locally in each player's browser.

## Anti-goals (failure even if it "works")

- **He feels scripted or cheats.** He must play through the same inputs and rules as the player. In Tankfield: the same stats formula, the same turret table, and aiming through turret angle. In Pocket Racer: the same car physics and the same gas/brake/steer/boost inputs. No rubber-banding, and no reading the player's inputs before they happen.
- **The live game changes in feel.** Splitting out the rules (see Approach) must not alter physics, timings or scoring for normal play. Old Pocket Racer ghosts and records must stay valid.
- **Training drifts away from the real game.** The trainer must run the exact rules code the browser runs.
- **Catastrophic forgetting.** A new version must never go live if it got worse against any opponent style in the hall of fame. Example: it gets better at beating beginners and reopens a gap that strong players found.
- **School laptops can't run it.** Most players use ThinkPads. Inference must stay a small fraction of the frame budget.
- **Recording leaks identity.** Training records must not contain account IDs, names, or emails.

## Constraints and facts about the current code

- Static site on GitHub Pages (`.nojekyll`), with Firebase Realtime Database for online features. Rules live in `database.rules.json` and the owner publishes them by hand in the Firebase console. Memory note: rules changes have been left unpublished before, so the plan must include an explicit publish step and a live check.
- Each game is one IIFE in `games/<id>/game.js` that mixes rules, drawing, input and menus. Byte Bot is the one exception: its rules live in `games/byte-bot/core.js` (the UMD-style `(function (root) {...})` pattern), shared with a Node level checker. That's the precedent for the split.
- **Tankfield** (`games/tankfield/game.js`, ~880 lines):
  - XP curve `xpFor = lv => 20 * lv^1.75` (line 55), level cap 45, and stat points granted up to level 34 (33 points total).
  - Stat formulas at lines 77–82, turret tree at line 34, rule bot `botControl` at line 209.
  - Score = total XP.
  - There is also a live 1v1 mode via `live.js`. It isn't affected.
- **Pocket Racer** (`games/pocket-racer/game.js` ~2,800 lines, plus `data.js`, `art.js`, `sound.js`):
  - 48 tracks, 8 cups (`data.js` `CUPS`) and a track builder.
  - Rule AI in `aiInput` (line 519) returns `{gas, brake, steer}` plus a boost flag. Rival difficulty tiers live in `data.js`.
  - Ghost recording stores position and angle at 10 Hz, keeping only the best runs (`ghosts/`, `pghosts/`). That isn't usable as training data: no inputs, no opponents, winners only.
- **Existing neural tooling to reuse** (from `../Stickman-Battles`):
  - `tools/brain/ppo.js` (JS MLP + GRU forward pass, checkpoint format);
  - `tools/brain/torch_ppo.py` (recurrent PPO with truncated BPTT);
  - `tools/brain/train.js` (rollout orchestration, GAE);
  - `js/smb-brain.js` (in-browser inference: observe, forward, sample, apply keys).

  Copy and adapt these. Don't create a cross-repo dependency.
- Accounts are Firebase Auth (anonymous guests or email). Writes need `auth != null`. The owner's two admin UIDs exist (see moderation memory) and can be used to grant the training lab read access.
- Commit style: no Co-Authored-By trailer.

## Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| **A. Split each game's rules into a shared `core.js`** that the browser game and a Node trainer both run headless | One careful refactor per game. Training runs at thousands of times real speed on the exact real rules, and recordings line up with the real game | **Chosen** |
| B. Drive the real game in a hidden browser (Playwright, as the Stickman lab does) | No refactor, but roughly 20–50× slower. Stickman needed 63+ hours of training, which kills fast experiments | Rejected |
| C. Write simplified re-implementations of the games for training | Fast to build, but the physics drift. Strange strategies might just be bugs in the copy | Rejected |

Within approach A, the learning model is **"trained offline, adapts within a match, retrained on everyone's matches"**:
- Considered: frozen-only (no learning from players), and per-player memory saved in the browser.
- The owner picked learning from all players.
- In-match GRU adaptation is kept because it's the actual research target.

## Design

### 1. Shared rules cores

- `games/tankfield/core.js` and `games/pocket-racer/core.js` hold the simulation: entities, physics, combat or collision, XP and levelling, lap and finish logic. They use the Byte Bot `(function (root) {...})` export pattern, so they load as a browser script and as a Node `require`.
- A core has no references to DOM, canvas, audio, `Arcade.*`, `Online.*`, or particles. Visual effects are emitted as events (e.g. `{type:'hit', x, y}`) that `game.js` turns into particles, shakes and sounds.
- Randomness goes through an injectable RNG. The browser passes `Math.random`-equivalent behaviour, and the trainer passes a seeded RNG.
- The core is stepped with explicit `dt`. The trainer uses a fixed step, and the browser keeps its current frame timing.
- **Parity requirement:** after the split, normal play must be indistinguishable from before. For Pocket Racer, the existing handling must reproduce identical trajectories for the same inputs; ghosts and records depend on it. The builder should capture before/after input-to-trajectory traces and diff them.

### 2. Sovereign runtime (in the browser)

- A shared runtime file (e.g. `assets/js/sovereign.js`):
  - loads a weights JSON for a game;
  - runs the MLP + GRU forward pass;
  - exposes `observe → decide → apply inputs` hooks that each game implements.
- **Weights** are static JSON committed to the repo, e.g. `games/tankfield/sovereign/v14.json`, plus a `latest.json` pointer that carries the version number. Promotion is a commit.
- Decision rate: every few frames, like Stickman's `REPEAT=3`. The builder picks the exact rate. Inference must fit easily on a school ThinkPad. A 128-wide network is fine, but the builder should measure it.
- If weights fail to load, the game falls back to its rule-based boss behaviour (a buffed rule bot) and **does not grant Sovereign achievements** for that fight.
- **Tankfield controls:** move vector, turret aim (as a target angle or turn rate), fire. The build (turret choices and stat allocation) comes from a separate build head that runs once at spawn. It reads the player's current build, so he can counter-build. That's a research question in its own right.
- **Pocket Racer controls:** steer, gas, brake, boost, the same inputs a player has.
  - Observations are track-relative (upcoming curvature and track edges as look-ahead samples, plus position within the lane) rather than track IDs, so one network drives every track, including builder-made ones.
  - The opponent's relative position, speed and boost state are included.

### 3. Game integration

- **Tankfield:**
  - At score ≥ 20,000, a boss-intro moment (banner, sound, camera cue), then Sovereign spawns at level 45 near, but not on top of, the player.
  - Normal rivals don't target him or the player while the duel is on. The builder decides what the rivals do instead.
  - He spawns once per game carrying 20,000 XP, so the normal kill formula (`victim.xp * 0.5 + 50`) pays about **10,050 XP**, which counts toward score as usual. The owner considers this a fair reward: top scores already reach about 100k. Killing him also grants the achievement. Dying to him ends the run normally.
- **Pocket Racer:**
  - New "Sovereign Duel" entry in the menu: best of 3, random built-in tracks, 3 laps, both cars on identical stats.
  - Career boss event appears after cup 8 is cleared.
  - Neither mode posts to leaderboards or ghosts.
  - Duel UI shows series score and the Sovereign version.
- **Achievement metadata:** when a Sovereign achievement unlocks, store the version beaten alongside it locally (e.g. `sovereign:beaten:<game>` → `{v, t}`), so the profile can show "vs. v14". "Sovereign Slayer" checks every game in a list kept in one place.

### 4. Training recorder

- Records every Sovereign fight or duel to completion, whether the player won or lost. Abandoned matches are dropped.
- Per decision step: the observation-relevant state of both sides, plus the player's inputs and Sovereign's inputs. It also stores the game, the Sovereign version, the outcome, and an anonymous session tag: a random per-browser ID, not the auth UID.
- Compressed (quantized, delta-encoded string, like the ghost encoding). Target is about 20 KB per match, with a hard per-record size limit in the rules.
- Written to a new `trainrec/<game>/<pushId>` path.
  - Rules: write requires `auth != null`, a validated shape and size, and **no public read**. Only the owner's admin UIDs can read.
  - **No per-UID rate limiter.** A UID-keyed timestamp node would let an admin link records to accounts by time. Per-record size validation is the only abuse limit. The owner doesn't treat bad-faith data as a threat, because Sovereign learns to beat opponents rather than copy them. *(Builder-check call.)*
  - Records are anonymous to everyone, including the owner. The session tag is a random per-browser ID, unrelated to the account.
  - A one-line notice in the Tankfield boss intro and the Pocket Racer duel/boss menus: "Matches against Sovereign help train him." No opt-out. *(Builder-check call.)*
  - **Retention:** the lab deletes records from Firebase after downloading them, which needs an admin-only delete rule. That keeps the free Spark tier (1 GB) from filling. *(Builder-check call.)*
  - Write failures are silent and never interrupt play.
- **Deploy note:** the plan must include publishing `database.rules.json` and checking it live (a public read of `trainrec/` must be denied, and an authenticated write must succeed).

### 5. Training lab (on the owner's Mac)

- Lives in the arcade repo under `tools/sovereign/`. **The site serves the repo directly from GitHub Pages, with no build step, so anything committed is public.** Only lab code and shipped Sovereign weights are committed. Downloaded `trainrec` data, behaviour-cloned player-style models and run reports are gitignored and stay on the owner's Mac. *(Builder-check call.)*
- **Retraining and promotion are run by hand for now.** The owner runs the training script, reads the exam report, and commits the new weights. Automating it (scheduled retrain, auto-commit on a passed exam, rollback, alerts) is a later step, once the exam is trusted. It is out of scope here. It contains:
  - headless rollout runners per game (Node, using the cores);
  - the PPO + GRU trainer (adapted from Stickman's `torch_ppo.py` or `ppo.js`);
  - a downloader for `trainrec/`;
  - the evaluation and report scripts.
- **Bootstrapping (no human data needed):**
  - self-play;
  - the existing rule bots (Tankfield `botControl`, Pocket Racer `aiInput` at each difficulty tier);
  - scripted style variants, such as an always-kiting tank or a racer who always takes the inside line;
  - scripted switchers that change style mid-match, so adaptation actually pays off.
- **Using human data:** recordings train behaviour-cloned "player-style" opponents, and Sovereign trains *against* those. He learns to beat what students do; he never copies them.
- **Owner's anti-forgetting rules:**
  - Learning rate and update size decay over the network's lifetime: big changes early, small ones later, within a PPO trust region.
  - A **hall of fame** holds the hardest opponent styles ever faced (rule bots, scripted styles, cloned players that once beat him). It is always mixed into training.
  - **Promotion exam:** a candidate goes live only if it doesn't regress against any hall-of-fame member and beats the current live version head-to-head. The exact thresholds are for the builder to choose and document.
- **Research reports per run:** win rates by opponent style, strategy summaries, memory ablations (GRU off or wiped mid-match), switch-adaptation curves (performance before and after an opponent switches style) and the evolution of build choices. Write them as markdown or HTML under `tools/sovereign/reports/`.

## Left to the builder

- Exact observation and action encodings, network sizes, decision rate, PPO hyperparameters and promotion thresholds. Start from the Stickman checkpoint format and document what was chosen.
- How the Pocket Racer core is carved out of the 2,800-line file. Hard requirement: trajectory parity.
- Tankfield rival behaviour during the boss fight, the boss intro presentation, and the achievement names other than "Racing God" and "Sovereign Slayer".
- Rule-bot fallback strength when weights fail to load.
- Recording encoding details and the exact rate limit.
- Order of work. Suggested: Tankfield core → recorder → lab bootstrap → Tankfield boss live; then the same for Pocket Racer.
