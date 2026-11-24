# Sovereign for Tankfield: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a neural-network boss, Sovereign, into Tankfield at 20,000 score, along with the full lab that trains him, records real fights, and promotes new versions by hand.

**Architecture:**
- Tankfield's rules move into a shared `games/tankfield/core.js`. It runs in the browser, and headless in Node for training.
- Sovereign's observation/action encoding (`games/tankfield/sovereign-io.js`) and the network runner (`assets/js/sovereign.js`) are also shared, so the browser and the lab compute exactly the same thing.
- The lab lives under `tools/sovereign/`:
  - Node rollouts on worker threads;
  - a PyTorch PPO sidecar, copied from Stickman-Battles;
  - an exam and hall of fame;
  - a recorder downloader and behaviour cloning.
- It ships weights as static JSON that the owner commits by hand.

**Tech Stack:**
- Plain browser JS, the existing IIFE and UMD patterns.
- Node 25 with `node:test` (no test deps) and `worker_threads`.
- Python venv with `torch` + `numpy`.
- `firebase-admin` (devDependency, lab only).
- Firebase RTDB rules.

**Spec:** `docs/superpowers/specs/2026-11-23-sovereign-arcade-ai-design.md`

**Scope:** Tankfield only. Pocket Racer gets its own plan afterwards. It reuses `assets/js/sovereign.js`, the recorder, the rules, the lab's `nn/`, exam and pull tooling, and the `<game>-sovereign` flag convention built here.

## Global Constraints

- Sovereign spawns when the player's score (`me.xp`) reaches **20,000**.
  - He is **level 45**, carries **20,000 XP**, and has all **33** stat points spent by his build policy.
  - He spawns **once per game**.
- Killing him pays the normal formula, `Math.round(t.xp * 0.5) + 50` (= 10,050), into score as usual.
- He plays through the same rules and inputs as the player. No stat buffs, no rubber-banding, no reading the player's inputs.
  - His aim works like the player's auto-aim: a lead-predicted bearing, smoothed at `dt * 12`, plus a network-chosen offset.
- Normal play must feel unchanged after the core split: same formulas, constants and turret table.
- Recordings hold no UID, name or email. The session tag is a random per-browser ID stored under the local key `sovereign:tag`.
- `trainrec/` has **no public read**, and the lab reads it with firebase-admin.
- The per-record `frames` string is **< 60000** characters, the same limit as ghosts.
- Intro copy, exactly: **"Matches against Sovereign help train him."**
- Achievement flag ids:
  - `tankfield-sovereign`: beat him;
  - `sovereign-slayer`: arcade-wide, checks `SOVEREIGN_GAMES = ['tankfield']` for each `<game>-sovereign` flag.
- Version beaten is stored locally under `sovereign:beaten:tankfield` as `{ v, t }`.
- If the weights fail to load, a rule-bot boss fights instead and **no Sovereign flags are granted**.
- Committed: lab code and `games/tankfield/sovereign/*.json` weights.
- Gitignored: `tools/sovereign/.venv/`, `tools/sovereign/runs/`, `tools/sovereign/data/`, `tools/sovereign/reports/`, `tools/sovereign/clones/`, `tools/sovereign/service-account.json`.
- No Co-Authored-By trailer on commits.
- Promotion is manual: `node tools/sovereign/promote.js` then commit. Nothing auto-pushes.

## Review Focus

1. **Player pauses or tabs away mid-boss-fight.** The fight must freeze cleanly. Delayed second-barrel shots must not fire during a pause. That means the core schedules them in sim time, not `setTimeout`. The test goes in Task 1.
2. **Player dies to a rival tank, or to a shape, during the boss fight.** The run ends normally. The recorder still uploads the fight with outcome `"other"`, and no flag is granted. The test goes in Task 9.
3. **Weights JSON 404s or is malformed** (offline, cached old page). The fallback boss spawns, no flags are granted, and nothing throws. The test goes in Task 9.
4. **Admin `/win` or `/score` used while the boss is up.** Existing taint rules apply to score. `tankfield-sovereign` must only be flagged by an actual kill of the Sovereign tank by `me`. The test goes in Task 9.
5. **Firebase write fails, or the player is offline.** Recording silently drops and play continues. The test goes in Task 10.

---

## File Structure

| File | Responsibility |
|---|---|
| `games/tankfield/core.js` (new, UMD → `TankCore`) | All simulation: constants, stat formulas, tanks, shapes, shots, XP, damage, collisions, rule bot, delayed barrels in sim time. No DOM/Arcade/Gfx. Emits events. |
| `games/tankfield/game.js` (modify) | Input, camera, drawing, HUD, menus, live 1v1, boss presentation. Calls `TankCore.step`. Turns events into fx and sounds. |
| `games/tankfield/sovereign-io.js` (new, UMD → `TankSovIO`) | `observe()`, `applyAction()`, `HEADS`, `OBS_DIM`, `buildFeatures()`, `applyBuild()`. Shared by the browser and the lab. |
| `games/tankfield/sovereign/latest.json`, `vN.json` (new) | Shipped weights: `{ v, pi, build }`. |
| `assets/js/sovereign.js` (new, UMD → `Sovereign`) | Net runner (`loadNet`, `newState`, `forward`, `sample`), `loadWeights(game)`, `Recorder`, session tag. |
| `assets/js/arcade.js`, `assets/js/catalog.js`, `assets/js/profile.js` (modify) | `sovereign-slayer` achievement, `tankfield-sovereign` extra, "vs. vN" on the profile. |
| `database.rules.json` (modify) | `trainrec` rules. |
| `tools/sovereign/nn/ppo.js`, `torch_ppo.py`, `torch_client.js` (copied, then adapted) | MLP, Adam and the PPO sidecar, from `../Stickman-Battles/tools/brain/`. |
| `tools/sovereign/tankfield/env.js` | Headless duel episode: `makeDuel`, `runEpisode`. |
| `tools/sovereign/tankfield/styles.js` | Scripted opponent styles and the player-build sampler. |
| `tools/sovereign/tankfield/build-policy.js` | Build bandit (REINFORCE) over turret path and stat allocation. |
| `tools/sovereign/train.js` | Training loop: workers, opponent mix, LR/KL schedule, checkpoints. |
| `tools/sovereign/exam.js`, `promote.js`, `report.js` | Promotion exam and hall of fame, weight publishing, research report. |
| `tools/sovereign/pull.js`, `clone.js` | Download and delete `trainrec`, then train behaviour clones. |
| `tools/sovereign/README.md` | Setup and the run book. |
| `tools/sovereign/test/*.test.js` | `node --test tools/sovereign/test/` |

---

### Task 1: Extract `games/tankfield/core.js`

**Files:**
- Create: `games/tankfield/core.js`
- Create: `tools/sovereign/test/tank-core.test.js`
- Modify: `.gitignore`: add the gitignored paths from Global Constraints

**Interfaces:**
- Produces `TankCore`, also via `require`:
  - Constants: `AW, AH, STATS, MAX_STAT, TURRETS, SHAPE_KINDS, xpFor, LEVEL_CAP=45`.
  - Stat helpers: `maxHp(t), moveSpeed(t), reloadTime(t), shotDamage(t), shotSpeed(t), radius(t)`.
  - `createWorld({ rng, shapes=70 }) → world`.
    - `world = { tanks, shapes, shots, time, events: [], pending: [], rng, shapeId }`.
  - `makeTank(world, { name, color, bot }) → tank`. Same fields as today, plus `id`.
  - `place(world, t)`, `gainXp(world, t, n)`, `spend(world, t, statIndex) → bool`, `botSpend(world, t)`, `setTurret(world, t, id)`.
  - `fire(world, t)`: delayed barrels go into `world.pending` as `{ at, fn }` and run inside `step` once `world.time >= at`.
  - `damage(world, target, n, by)`, `drive(world, t, mx, my, dt)`, `botControl(world, t, dt, opts) → { mx, my }`.
    - `opts.ignore`: a Set of tanks never chosen as a foe. Used for the boss fight.
    - `opts.graceTarget`, `opts.graceUntil`: replace the hard-coded `o === me && time < 30 && !ai.provoked` check.
  - `respawnBot(world, t)`.
  - `step(world, dt, controls)`. `controls` is a `Map<tank, { mx, my, aim, fire }>`, where `aim` is the absolute target angle or `null`. It moves controlled tanks (turret smoothing done by the caller), runs `botControl` for bots not in `controls`, then shots, shapes, rams, refills shapes and pending barrels.
  - `world.events` gets `{ type, ... }` entries: `'levelUp' {t}`, `'turretPick' {t, options}`, `'shot' {t, shot}`, `'hit' {target, n, by, x, y}`, `'shapeKilled' {s, by}`, `'tankKilled' {t, by, xp}`, `'shapeHit' {s, n, by}`. The caller drains them with `world.events.length = 0`.
  - Tanks marked `remote: true` are never simulated or damaged locally. That's the existing live-mode semantics, now generic.
  - `opts.spawnShapes` on step (default `true`): the live guest passes `false`.
- Consumes: nothing.

- [ ] **Step 1: Write failing tests** in `tank-core.test.js`, using a seeded RNG (mulberry32 helper in the test file):
  - `xpFor(29) === 7248` and `xpFor(44) === 15034`.
  - `gainXp` to 20,000 → `level === 45`, and points received total 33.
  - `spend` refuses above `MAX_STAT=7` and when `points===0`.
  - Two worlds with the same seed and the same controls for 600 steps at `dt=1/60` → identical `JSON.stringify` of tank positions/hp.
  - Twin turret: after `fire`, `shots.length===1`, `pending.length===1`. With no `step` called, nothing more fires. After stepping `0.5*reload` seconds, `shots.length===2`. (This is the pause safety from Review Focus 1.)
  - Kill payout: tank A with 20,000 xp killed by B → B gains exactly `Math.round(20000*0.5)+50`, and a `'tankKilled'` event with `xp:10050`.
  - A `remote:true` tank takes no damage from `damage()`.
- [ ] **Step 2:** `node --test tools/sovereign/test/` → FAIL (module missing).
- [ ] **Step 3: Implement `core.js`.** Move the rule code from `game.js` lines 22–56, 64–254, 286–410 nearly verbatim. Then:
  - Replace `me`/`netMode`/`Arcade`/`fx`/`floats`/`shake`/`setTimeout` uses with events or parameters.
  - Replace `Math.random`/`Gfx.rand` with `world.rng`.
  - Keep player-only side effects (flags, tones, `picking`) for `game.js` to do from events.
  - Bots pick turrets with `world.rng`.
  - Export with the Byte Bot UMD footer.
- [ ] **Step 4:** `node --test tools/sovereign/test/` → all PASS.
- [ ] **Step 5: Commit** `Tankfield: move the rules into core.js`.

### Task 2: Run `game.js` on the core

**Files:**
- Modify: `games/tankfield/game.js`, `games/tankfield/index.html` (add `<script src="core.js">` before `game.js`)

**Interfaces:**
- Consumes `TankCore` from Task 1.
- Produces: `game.js` keeps one `world` with `rng = () => Math.random()`. Versus seeding still works, because `versus.js` seeds `Math.random`.
- Player control becomes `controls.set(me, { mx, my, aim: null, fire })` after applying the existing aim smoothing to `me.a` in `game.js`.

- [ ] **Step 1:** Delete the moved code from `game.js`. Point `tanks/shapes/shots` reads at `world.*`.
  - Replace the per-frame update body with: input → `TankCore.step(world, dt, controls, { spawnShapes: netMode !== 'live' || live.host })` → drain events into fx, floats, shake, tones, `Arcade.flag`, `picking`, and `liveShots`/`liveHits`/`goneShapes`.
  - Keep the `me` death → `gameOver` / `liveDied` from the `'tankKilled'` event.
- [ ] **Step 2: Browser check.** Serve with `npx http-server -p 8080 -c-1`, open `games/tankfield/`, and drive it via the agent-chrome tools:
  - Normal run: level to 10 and pick a turret. Kill a rival (the `+N` float shows). Pause with P while firing Twin; no shot appears during the pause. Die → the game-over card shows the score.
  - Console has no errors.
- [ ] **Step 3: Live 1v1 check.** Two tabs, `#` invite flow: host and guest both see shapes. Shots are visible on both, a kill counts on both, and the match ends.
- [ ] **Step 4: Commit** `Tankfield: run the game on core.js`.

### Task 3: Shared net runner `assets/js/sovereign.js`

**Files:**
- Create: `assets/js/sovereign.js`
- Copy: `../Stickman-Battles/tools/brain/{ppo.js,torch_ppo.py,torch_client.js}` → `tools/sovereign/nn/`
- Test: `tools/sovereign/test/net.test.js`

**Interfaces:**
- Produces `Sovereign` (UMD; `module.exports` in Node):
  - `loadNet(json) → net`. Same format as `smb-brain.js` `loadNet`: `{ sizes, W, b, gru? }`, base64 or arrays.
  - `newState(net) → Float32Array|null`.
  - `forward(net, x, h) → Float32Array logits`.
  - `sample(logits, heads, act: Int32Array, greedy) → logp`. Note: `heads` is a parameter, unlike in Stickman.
  - `loadWeights(game) → Promise<{ v, pi, build } | null>`. It fetches `/games/<game>/sovereign/latest.json`, resolved relative to the page. It never throws; `null` on failure.
  - `sessionTag()`: a random 12-char id, persisted via `Arcade.load/save('sovereign:tag')`.
- `torch_client.js` changes:
  - venv path → `tools/sovereign/.venv`;
  - error text updated to match.
- `torch_ppo.py` changes: none in this task (`HEADS` already comes from `cfg`).

- [ ] **Step 1: Failing tests:**
  - With no GRU, `forward` equals `nn/ppo.js` `MLP.forward` on the same weights, within `1e-5`, on random input.
  - With a GRU whose `M` is zero, the logits equal the no-GRU logits.
  - `sample` with `greedy` returns the argmax per head, and `logp` equals the sum of the log-softmaxes.
  - `loadNet` round-trips base64-encoded weights.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** by porting `smb-brain.js` lines 30–106, with `heads` passed in. Include `_b64ToF32` and a matching `f32ToB64` (exported for the lab).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `Sovereign: shared network runner`.

### Task 4: Observation and action encoding `games/tankfield/sovereign-io.js`

**Files:**
- Create: `games/tankfield/sovereign-io.js`
- Test: `tools/sovereign/test/tank-io.test.js`

**Interfaces:**
- Consumes `TankCore`.
- Produces `TankSovIO`:
  - `HEADS = [9, 9, 2]`:
    - **move:** none + 8 directions;
    - **aim offset:** radians `[-0.4, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.4]` added to the lead-predicted bearing to the opponent;
    - **fire:** no/yes.
  - `REPEAT = 3`: one decision per 3 sim frames at 60 Hz.
  - `OBS_DIM`: exported, and asserted in tests.
  - `observe(world, self, opp, prevAct: Int32Array, out: Float32Array)`. The feature groups below are all relative to `self`, scaled to about [-1, 1]:
    - self: hp/max, vx, vy, reload/reloadTime, the 7 stats/7, turret one-hot over `Object.keys(TURRETS)`;
    - opponent: dx, dy, distance/1000, vx, vy, hp/max, 7 stats, turret one-hot, sin/cos of (opp aim − bearing from opp to self), reload fraction;
    - the 8 nearest enemy shots (dx, dy, vx, vy, zero-padded);
    - the 4 nearest shapes (dx, dy, r);
    - wall distances (4);
    - previous action one-hots.
  - `applyAction(world, self, opp, act, dt) → { mx, my, aim, fire }`. The aim angle is the lead-predicted bearing plus the offset. The caller passes it in `controls`, and `game.js` / `env.js` smooth `self.a` toward it at `dt * 12`, the same as player auto-aim.
  - `buildFeatures(tank) → Float32Array`: the 7 stats/7 plus a turret one-hot.
  - `BUILD_PATHS`: every `[level10, level20]` pair from `TURRETS.basic.next` × each one's `next`.
  - `applyBuild(world, tank, { path, alloc })`:
    - sets level 45 with 20,000 xp;
    - sets the turret to `path[1]`;
    - spends `alloc` (an array of 33 stat indices, capped at 7 each);
    - sets hp to max.
- In the browser it reads `TankCore` from `window`.

- [ ] **Step 1: Failing tests:**
  - `observe` writes exactly `OBS_DIM` finite values.
  - Mirroring the world (swap self/opp) gives the opponent block of one equal to the self block of the other.
  - `applyAction` with aim-offset index 4 against a stationary opponent returns `aim === Math.atan2(dy, dx)`.
  - `applyBuild` → level 45, `Object.values(stats)` sum 33, every stat ≤ 7, `xp === 20000`.
  - `BUILD_PATHS.length` equals the leaf count computed from `TURRETS`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `Tankfield: Sovereign observation and action encoding`.

### Task 5: Headless duel env and scripted opponents

**Files:**
- Create: `tools/sovereign/tankfield/env.js`, `tools/sovereign/tankfield/styles.js`
- Test: `tools/sovereign/test/tank-env.test.js`

**Interfaces:**
- Consumes `TankCore`, `TankSovIO`, `Sovereign`.
- Produces:
  - `styles.js`:
    - `STYLES = { kiter, rusher, strafer, sniper, farmer, switcher }`. Each is `(world, self, opp, dt, mem) → { mx, my, aim, fire }`, using player-like auto-aim (lead bearing, `R(-0.08, 0.08)` jitter).
    - `switcher` changes between the other styles every 15–40 s and logs the switch times in `mem.switches`.
    - `sampleBuild(rng, styleName) → { path, alloc }`: plausible player builds, e.g. rusher favours ram/armor/speed, sniper favours the longshot path.
  - `env.js`:
    - `makeDuel({ seed, sovBuild, oppBuild, shapes=70 }) → { world, sov, opp }`. The tanks are placed 700 px apart near the centre.
    - `runEpisode({ seed, sovNet, sovGreedy=false, opponent, maxT=120, memWipeEvery=0, histOff=false }) → { obs, acts, logps, rews, done, outcome: 'win'|'loss'|'timeout', len, switches, stats }`.
    - `opponent` is `{ kind: 'style', name }` | `{ kind: 'net', net, greedy }` (self-play, hall of fame, clones) | `{ kind: 'idle' }`.
    - Reward per decision: `(dmgDealt − dmgTaken) / 400`, `+3` kill, `−3` death, `0` on timeout.
    - When `memWipeEvery > 0`, Sovereign's GRU state is zeroed every N decisions (the research ablation).

- [ ] **Step 1: Failing tests:**
  - `runEpisode` against `idle` with a random net terminates by `maxT` and returns arrays of equal length `len`, where `obs.length === len * OBS_DIM`.
  - The same seed and net run twice → identical `rews`.
  - `switcher` over 120 s records ≥ 2 switches.
  - `sampleBuild` always yields 33 points with every stat ≤ 7.
  - A scripted `rusher` beats `idle` in ≥ 9/10 seeds. This is a sanity check that the styles fight.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `Sovereign lab: Tankfield duel env and opponent styles`.

### Task 6: Training loop

**Files:**
- Create: `tools/sovereign/train.js`, `tools/sovereign/README.md`
- Modify: `package.json`: add `"scripts": { "test:sovereign": "node --test tools/sovereign/test/" }`
- Test: `tools/sovereign/test/train-smoke.test.js` (skipped when `.venv` is missing)

**Interfaces:**
- Consumes `env.js`, `styles.js`, `nn/ppo.js` (MLP construction, `addGru`), `nn/torch_client.js` (`TorchPPO` init/update/weights).
- CLI: `node tools/sovereign/train.js --game=tankfield --run=<name> [--iters=N] [--hours=H] [--workers=K] [--from=<ckpt>] [--clones=<dir>]`
- Writes `tools/sovereign/runs/<name>/`:
  - `latest.json`: `{ iter, pi, vf, cfg, lr, hof: [...] }`;
  - `snapshots/iter-<n>.json` every 25 iterations;
  - `log.jsonl`: per iteration, win rate per opponent kind, mean reward, KL, lr.
- Net: `pi [OBS_DIM, 128, 128, sum(HEADS)]`, `vf [OBS_DIM, 128, 128, 1]`, GRU H=64.
- `cfg = { HEADS, gamma: 0.99, lambda: 0.95, clip: 0.2, epochs: 4, mb: 2048, entCoef: 0.01, maxGrad: 0.5, seqLen: 128 }`.
- **Owner's decaying-change rule:** `lr = 3e-4 * max(0.1, 0.5 ** (iter / 400))` and `targetKl = 0.03 * max(0.2, 0.5 ** (iter / 400))`.
- **Opponent mix per iteration:**
  - 40% scripted styles, with `switcher` at least 15% of all matches;
  - 30% self-play against a random snapshot;
  - 30% hall of fame (Task 8), plus clones when `--clones` is given.
  - Before any hall of fame exists, those 30% go to styles.
- Rollouts are spread across `worker_threads`, each running `runEpisode` with the current weights.

- [ ] **Step 1: Failing smoke test:** `train.js --iters=2 --workers=1` with a tiny `--steps=2000` exits 0 and writes `latest.json` with `iter === 2` and two `log.jsonl` lines.
- [ ] **Step 2:** FAIL. **Step 3:** Implement, using the structure of Stickman `train.js` without the browser workers.
- [ ] **Step 4:** PASS. Then a learning sanity run: `--iters=60`. In `log.jsonl`, the win rate against `idle` and `farmer` rises above 0.8. Record the actual numbers in the commit message.
- [ ] **Step 5:** `README.md` with:
  - venv setup (`python3 -m venv tools/sovereign/.venv && tools/sovereign/.venv/bin/pip install torch numpy`);
  - train, exam, promote, pull and clone commands.
- [ ] **Step 6: Commit** `Sovereign lab: PPO training loop for Tankfield`.

### Task 7: Build policy

**Files:**
- Create: `tools/sovereign/tankfield/build-policy.js`
- Modify: `tools/sovereign/train.js`: sample the build per episode and update after each iteration
- Test: `tools/sovereign/test/build-policy.test.js`

**Interfaces:**
- Net: `nn/ppo.js` `MLP([BUILD_IN, 32, BUILD_PATHS.length + 7])`. The input is the opponent's `buildFeatures`.
- `sampleBuild(net, oppFeatures, rng, greedy) → { path, alloc, logp }`:
  - one categorical for the path;
  - 33 sequential categorical draws from the 7 stat logits, masking stats at 7;
  - `logp` is the sum.
- `updateBuild(net, adam, batch: [{ oppFeatures, path, alloc, outcome: +1|-1|0 }])`: REINFORCE with a mean baseline, plus 0.01 entropy.
- Saved in the checkpoint as `build`. Shipped in the weights JSON as `build`.

- [ ] **Step 1: Failing tests:**
  - The allocation always sums to 33 with every stat ≤ 7.
  - Greedy is deterministic.
  - After 300 synthetic updates where path 0 always wins and the others lose, P(path 0) > 0.8.
- [ ] **Step 2:** FAIL. **Step 3:** Implement and wire into `train.js`. **Step 4:** PASS.
- [ ] **Step 5: Commit** `Sovereign lab: build policy picks turret path and stats`.

### Task 8: Hall of fame, exam and promotion

**Files:**
- Create: `tools/sovereign/exam.js`, `tools/sovereign/promote.js`
- Test: `tools/sovereign/test/exam.test.js`

**Interfaces:**
- Hall of fame file: `tools/sovereign/runs/<name>/hof.json` → `[{ id, kind: 'style'|'net'|'clone', ref, bestWinRateVsSov }]`.
  - It starts with every style.
  - Any snapshot, clone, or style that beats the current Sovereign more than 45% of the time in exam games is added.
  - It is capped at 24 members, dropping the weakest-against-Sovereign first.
- `node tools/sovereign/exam.js --game=tankfield --cand=<ckpt> [--live=games/tankfield/sovereign/latest.json] [--games=40]`:
  - plays greedy Sovereign against each hof member, at `--games` seeds each;
  - plays candidate vs live head-to-head (both greedy, 2 × `--games`, swapping spawn sides);
  - writes `tools/sovereign/reports/exam-<ts>.md` and prints `PASS`/`FAIL`.
- **Pass rule:**
  - no hof member's win rate against the candidate is more than **5 points** higher than against live;
  - **and** the candidate wins ≥ **55%** head-to-head against live;
  - with no live version yet, only the hof part applies.
- `node tools/sovereign/promote.js --game=tankfield --cand=<ckpt>`:
  - refuses unless the newest exam report for this `cand` says PASS;
  - writes `games/tankfield/sovereign/v<N+1>.json` as `{ v, pi, build }` (pi without vf, weights base64) and copies it to `latest.json`;
  - prints the `git add`/`git commit` line for the owner to run.

- [ ] **Step 1: Failing tests:** the pass rule as a pure function `examVerdict(results)`:
  - a regression of +6 points on one member → FAIL;
  - 54% head-to-head → FAIL;
  - no live version and no regressions → PASS;
  - `promote` with no report → exit 1.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `Sovereign lab: hall of fame, promotion exam and promote script`.

### Task 9: The boss in Tankfield

**Files:**
- Modify: `games/tankfield/game.js`, `games/tankfield/index.html` (scripts `../../assets/js/sovereign.js` and `sovereign-io.js` after `core.js`)
- Modify: `assets/js/catalog.js`: Tankfield `extras` gets `{ id: 'tankfield-sovereign', title: 'Tankfield: Dethroned', desc: 'Destroy Sovereign, the level 45 boss tank.' }`
- Modify: `assets/js/arcade.js`: in `achievementList`, add `const SOVEREIGN_GAMES = ['tankfield']` and `{ id: 'sovereign-slayer', title: 'Sovereign Slayer', desc: 'Beat Sovereign in every game he appears in.', test: s => SOVEREIGN_GAMES.every(g => s.flags[g + '-sovereign']) }`
- Modify: `assets/js/profile.js` (around line 157): for an unlocked `<game>-sovereign` achievement, append ` · vs. v${n}` from `Arcade.load('sovereign:beaten:<game>')`
- Commit the first weights: whatever Task 6/8 promoted, which must be at least one `v1.json` + `latest.json`

**Interfaces:**
- Consumes `TankCore`, `TankSovIO`, `Sovereign`, and the weights JSON.
- Produces in `game.js`:
  - `boss = { tank, net, state, act, prev, decisionT, version, fallback: bool, recorder }`;
  - `spawnBoss()`, `bossControl(dt) → controls entry`.
- Weights are prefetched with `Sovereign.loadWeights('tankfield')` when a solo run starts.

- [ ] **Step 1: Spawn.** When `me.xp >= 20000` in a solo run (not live, not Versus), and the boss hasn't spawned this game:
  - Show a banner: "SOVEREIGN HAS ENTERED", subline "Matches against Sovereign help train him." Use the shake and tone already used for big events.
  - Make a tank named `Sovereign`, colour `#ffd23f`, 700 px from the player, in a random direction, clamped inside the arena.
  - Build: `TankSovIO.applyBuild` with `sampleBuild(buildNet, buildFeatures(me), rng, greedy=true)`.
  - Fallback build if weights are null: path `['longshot', 'rail']`, alloc 7 shotPower / 7 reload / 7 shotSpeed / 6 armor / 6 speed.
- [ ] **Step 2: Duel rules.**
  - Rivals call `botControl` with `opts.ignore = new Set([me, boss.tank])` while the boss is alive.
  - Sovereign is driven every `REPEAT` frames via `observe → forward → sample(greedy=true) → applyAction`, aim smoothed at `dt * 12`.
  - Fallback mode uses `TankCore.botControl` with `ignore` = the rivals, and the player as the only foe.
- [ ] **Step 3: Outcome.**
  - On the `'tankKilled'` event where `t === boss.tank`:
    - with `by === me` and not fallback → `Arcade.flag('tankfield-sovereign')`, `Arcade.save('sovereign:beaten:tankfield', { v: boss.version, t: Date.now() })`, recorder outcome `'win'` (the player's perspective);
    - killed by anything else → outcome `'other'`.
  - When `me` dies with the boss alive: outcome `'loss'` if `by === boss.tank`, otherwise `'other'`.
  - He never respawns. The normal kill XP flows through the core unchanged.
- [ ] **Step 4: Browser checks** (agent-chrome, `#autopilot` not needed). Use the console to set `me.xp` through an exposed debug hook `window.__tank` (only when `location.hash === '#dev'`):
  - At 20,000 the banner shows and Sovereign spawns at level 45 with 33 points.
  - Killing him (set his hp to 1, then shoot) → toast "Tankfield: Dethroned", and the profile shows "vs. v1".
  - **Review Focus 3:** block `sovereign/latest.json` (rename it locally) → fallback boss, kill → no flag, no console error.
  - **Review Focus 4:** `/score` admin command with the boss up → `tankfield-sovereign` not flagged.
  - **Review Focus 2:** the player dies to a rival mid-fight → the run ends normally.
  - Pause mid-fight → frozen.
  - Use the performance panel to confirm Sovereign's inference is < 1 ms per decision.
- [ ] **Step 5: Commit** `Tankfield: Sovereign boss at 20,000`.

### Task 10: Training recorder and rules

**Files:**
- Modify: `assets/js/sovereign.js`: add `Recorder`
- Modify: `games/tankfield/game.js`: record the boss fight
- Modify: `database.rules.json`: add `trainrec`
- Test: `tools/sovereign/test/recorder.test.js`

**Interfaces:**
- `new Sovereign.Recorder({ game, version, hz: 10 })`:
  - `.row(intArray)`
  - `.finish(outcome, meta) → record | null`
  - `.upload(record) → Promise<void>`: never rejects, swallows errors.
- `Sovereign.encodeRows(rows) / decodeRows(str)`: per-column delta, base36, `,` between values, `;` between rows. `row()` stops adding once the encoded length would pass 59000 and sets `truncated: true`.
- Tankfield row at 10 Hz, both tanks, integers:
  - `[x, y, round(vx), round(vy), round(a*100), hp]` × 2;
  - the player's `mx, my, fire`;
  - Sovereign's `act[0..2]`.
- Record shape: `{ g: 'tankfield', v, out: 'win'|'loss'|'other', tag, pb: playerBuild, sb: sovBuild, dur, trunc, frames, t: Online.TIMESTAMP }`.
- `upload` = `Online.post('trainrec/tankfield', record)` when `Online.enabled`.
- Rules under root:
  ```
  "trainrec": { ".read": false, "$game": { "$rec": {
    ".write": "auth != null && !data.exists() && newData.exists()",
    ".validate": "newData.hasChildren(['g','v','out','tag','frames','t']) && newData.child('frames').isString() && newData.child('frames').val().length < 60000 && newData.child('tag').isString() && newData.child('tag').val().length <= 16 && newData.child('t').val() <= now && $game.length < 24"
  } } }
  ```

- [ ] **Step 1: Failing tests:**
  - `decodeRows(encodeRows(rows))` deep-equals `rows`, including negatives.
  - 3,000 rows × 18 columns of realistic values stay < 60000 chars, or truncate with `trunc: true`.
  - The record has no `uid`/`name` keys.
  - `upload` resolves even when `Online.post` rejects.
- [ ] **Step 2:** FAIL. **Step 3:** Implement and wire into `game.js` (start at spawn, `finish` on the outcome from Task 9, `finish` with `'other'` if the page unloads). **Step 4:** PASS.
- [ ] **Step 5: Rules check** with the local emulators (memory note: firebase-tools 13.29.1 on Node 25 needs `lib/templates` symlinked):
  - an authenticated write succeeds;
  - an unauthenticated write is denied;
  - a public `GET trainrec.json` → Permission denied;
  - a record with a 60,001-char `frames` → denied.
- [ ] **Step 6: Commit** `Sovereign: record boss fights for training`.

### Task 11: Pull, clone and research report

**Files:**
- Create: `tools/sovereign/pull.js`, `tools/sovereign/clone.js`, `tools/sovereign/report.js`
- Modify: `package.json`: `devDependencies.firebase-admin`
- Modify: `tools/sovereign/train.js`: `--clones=<dir>` loads clone nets into the opponent mix
- Test: `tools/sovereign/test/clone.test.js`, `report.test.js`

**Interfaces:**
- `node tools/sovereign/pull.js --game=tankfield`:
  - uses `tools/sovereign/service-account.json` with firebase-admin;
  - appends each record as a JSON line to `tools/sovereign/data/tankfield.jsonl`;
  - then deletes exactly the downloaded keys (download first, delete second).
- `node tools/sovereign/clone.js --game=tankfield [--min=200]`:
  - trains `nn/ppo.js` MLP classifiers (no GRU) mapping the player's recorded perspective (the recorded columns only, `CLONE_IN` from the row layout) to the player's `mx, my, fire`;
  - writes `tools/sovereign/clones/tankfield/clone-<k>.json`;
  - clusters players by `tag` into up to 8 clones, using k-means over per-tag action histograms;
  - refuses with fewer than `--min` records.
  - The env gains `opponent: { kind: 'clone', net }`. Clones aim like player auto-aim.
- `node tools/sovereign/report.js --run=<name>` → `tools/sovereign/reports/<run>-<ts>.md` with:
  1. win rate per opponent style over training (from `log.jsonl`);
  2. memory ablation: greedy Sovereign against every style with GRU normal, `memWipeEvery=20`, and GRU state forced to zero;
  3. switch-adaptation curve: against `switcher`, damage-exchange rate in 5 s bins relative to each switch time (−10 s … +20 s);
  4. build choices: path and stat histogram against each style's builds;
  5. engagement stats: mean distance, time at range bands, and shots fired per second.

- [ ] **Step 1: Failing tests:**
  - A clone trained on synthetic data where `mx = sign(dx)` reaches ≥ 95% accuracy.
  - The switch-curve function, given synthetic per-second exchange data with a known dip at +3 s, puts its minimum bin at +0–5 s.
  - `pull.js` handles empty `trainrec` (exit 0, prints `0 records`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `Sovereign lab: pull, clone players and research report`.

### Task 12: First training, release and deploy

**Files:** `games/tankfield/sovereign/v1.json`, `latest.json`, plus whatever the runs produce (gitignored).

- [ ] **Step 1:** Set up the venv per the README. Run `train.js --game=tankfield --run=t1 --hours=2` (adjust if win rates plateau earlier).
- [ ] **Step 2:** `exam.js --cand=runs/t1/latest.json` → PASS. Then `report.js --run=t1`, and show the owner the report highlights.
- [ ] **Step 3:** `promote.js` → `v1.json`/`latest.json`. Commit `Tankfield: Sovereign v1`.
- [ ] **Step 4:** Ask the owner before pushing. After the push, remind the owner to paste `database.rules.json` into the Firebase console. Then verify live:
  - `curl -s "<db>/trainrec.json"` → `"Permission denied"`;
  - play a boss fight on the live site (dev hook) and check that `pull.js` downloads 1 record.
- [ ] **Step 5:** Update the memory notes (rules publish state, the Sovereign pipeline).
