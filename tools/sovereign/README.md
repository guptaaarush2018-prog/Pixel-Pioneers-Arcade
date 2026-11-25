# Sovereign lab

Trains Sovereign, the neural boss, outside the browser. Everything here is dev-only: the
game ships only the promoted weights in `games/<game>/sovereign/`.

## Setup (once)

```sh
python3 -m venv tools/sovereign/.venv && tools/sovereign/.venv/bin/pip install torch numpy
```

The PPO update runs in PyTorch (`nn/torch_ppo.py`), spawned by `train.js`. Rollouts run in
Node worker threads on the same `games/tankfield/core.js` the game uses.

## Tests

```sh
npm run test:sovereign
```

The training smoke test is skipped when `.venv` is missing.

## Train

```sh
node tools/sovereign/train.js --game=tankfield --run=<name> [--iters=N] [--hours=H] [--workers=K] [--steps=S] [--from=<ckpt>] [--fresh]
```

- Output goes to `tools/sovereign/runs/<name>/` (gitignored): `latest.json` every iteration,
  `snapshots/iter-<n>.json` every 25, and `log.jsonl` with win rate per opponent, mean
  reward, KL and learning rate.
- A run resumes from its `latest.json` unless `--fresh`. Ctrl-C finishes the current iteration and saves.
- The learning rate and KL target decay with the iteration count (halving every 400, floored).

## Exam, promote, pull and clone

These arrive with later tasks of the plan (`docs/superpowers/plans/2026-11-23-sovereign-tankfield.md`):

```sh
node tools/sovereign/exam.js --game=tankfield --cand=tools/sovereign/runs/<name>/latest.json
node tools/sovereign/promote.js --game=tankfield --cand=tools/sovereign/runs/<name>/latest.json
node tools/sovereign/pull.js --game=tankfield
node tools/sovereign/clone.js --game=tankfield
```

Promotion is manual: `promote.js` writes the weights and prints the `git` commands; nothing pushes by itself.
