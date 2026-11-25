"""
tools/sovereign/nn/torch_ppo.py: the PPO update in PyTorch, run as train.js's sidecar. DEV ONLY.

train.js --torch spawns this with tools/sovereign/.venv/bin/python and talks to it over
stdin/stdout. The rollouts, the ladder, the bookkeeping and the checkpoint format
all stay in JS. This process only owns the two nets and their Adam state, and does
what ppo.js + pool.js did: values, GAE, advantage normalisation, the clipped
policy step and the value step, with the same loss, the same per-net gradient
clipping and the same KL early stop. Weights go back to JS as flat float32 in
ppo.js's layout (per layer: W row-major [out][in], then b), which is exactly
torch.nn.Linear's layout, so a checkpoint still loads into the browser's
Sovereign.forward() byte for byte.

Wire format, both ways: uint32 LE header length, JSON header, then the raw
buffers named in header["bufs"] ([name, dtype, count] with dtype f32 or i32),
concatenated in that order. Log lines go to stderr.

  init    {piSizes, vfSizes, gru, cfg, threads}  bufs pi, vf      -> {ok, device}
  update  {N, D, H, episodes:[[start, len, trunc]], seed, lr?, targetKl?}
          bufs obs, acts, logps, rews, finalObs                    -> {upd} bufs pi, vf
  step    one minibatch with given indices, no shuffle (parity test only)
          {N, D, H, m} bufs obs, acts, logps, adv, ret, idx        -> {st} bufs pi, vf
  weights                                                          -> bufs pi, vf
  seq     one sequence from an empty memory (parity test only)
          {T, D} bufs obs                                          -> bufs logits, v

Memory (init gru = H > 0): both nets carry a GRU fed by the first hidden layer and
added into the second (assets/js/sovereign.js forward). Its weights follow the layers in
the flat buffers: weight_ih, weight_hh, bias_ih, bias_hh, then the H -> hidden
matrix. The update then trains on whole matches cut into cfg.seqLen-decision
pieces: each piece starts from the memory the current weights reach by that point
(recomputed here from the match's first decision, so the browser sends nothing
extra) and gradients stop at the piece's edge.
"""
import json
import struct
import sys
import time

import numpy as np
import torch
import torch.nn as nn

DT = {"f32": np.float32, "i32": np.int32}
IN, OUT = sys.stdin.buffer, sys.stdout.buffer


def log(*a):
    print("[torch]", *a, file=sys.stderr, flush=True)


def read_exact(n):
    chunks, got = [], 0
    while got < n:
        c = IN.read(n - got)
        if not c:
            raise EOFError
        chunks.append(c)
        got += len(c)
    return b"".join(chunks)


def recv():
    (hl,) = struct.unpack("<I", read_exact(4))
    head = json.loads(read_exact(hl))
    bufs = {}
    for name, dt, n in head.get("bufs", []):
        size = n * 4
        bufs[name] = np.frombuffer(read_exact(size), dtype=DT[dt]) if size else np.zeros(0, DT[dt])
    return head, bufs


def send(head, bufs=()):
    head = dict(head)
    head["bufs"] = [[name, "f32" if a.dtype == np.float32 else "i32", int(a.size)] for name, a in bufs]
    h = json.dumps(head).encode()
    OUT.write(struct.pack("<I", len(h)))
    OUT.write(h)
    for _, a in bufs:
        OUT.write(np.ascontiguousarray(a).tobytes())
    OUT.flush()


class MLP(nn.Module):
    """ppo.js's MLP: tanh hidden layers, linear output. gru = H adds the memory block."""

    def __init__(self, sizes, gru=0):
        super().__init__()
        self.sizes = sizes
        self.layers = nn.ModuleList(nn.Linear(sizes[i], sizes[i + 1]) for i in range(len(sizes) - 1))
        self.gru = nn.GRU(sizes[1], gru, batch_first=True) if gru else None
        self.mem = nn.Linear(gru, sizes[2], bias=False) if gru else None

    def seq(self, x, h0):
        """x [B, T, in], h0 [B, H] -> output [B, T, out] and the memory after every step [B, T, H]."""
        a = torch.tanh(self.layers[0](x))
        g, _ = self.gru(a, h0.unsqueeze(0).contiguous())
        a = torch.tanh(self.layers[1](a) + self.mem(g))
        for i in range(2, len(self.layers)):
            a = self.layers[i](a)
            if i < len(self.layers) - 1:
                a = torch.tanh(a)
        return a, g

    def tensors(self):
        ts = [t for l in self.layers for t in (l.weight, l.bias)]
        if self.gru is not None:
            ts += [self.gru.weight_ih_l0, self.gru.weight_hh_l0, self.gru.bias_ih_l0, self.gru.bias_hh_l0, self.mem.weight]
        return ts

    def forward(self, x):
        for i, l in enumerate(self.layers):
            x = l(x)
            if i < len(self.layers) - 1:
                x = torch.tanh(x)
        return x

    def load_flat(self, flat):
        o = 0
        with torch.no_grad():
            for t in self.tensors():
                n = t.numel()
                t.copy_(torch.from_numpy(flat[o:o + n].copy()).view_as(t)); o += n
        assert o == flat.size, f"flat weights {flat.size} != params {o}"

    def flat(self):
        with torch.no_grad():
            return torch.cat([t.reshape(-1) for t in self.tensors()]).cpu().numpy().astype(np.float32)


class Trainer:
    def __init__(self, head, bufs):
        self.cfg = head["cfg"]
        self.heads = list(self.cfg["HEADS"])
        torch.set_num_threads(int(head.get("threads") or 4))
        self.dev = torch.device("cpu")
        self.H = int(head.get("gru") or 0)
        self.pi = MLP(head["piSizes"], self.H).to(self.dev)
        self.vf = MLP(head["vfSizes"], self.H).to(self.dev)
        self.pi.load_flat(bufs["pi"])
        self.vf.load_flat(bufs["vf"])
        # Reference policy (train.js --ref, e.g. the clone of the user): refKl * KL(pi || ref) joins the
        # policy loss, so training improves the net without walking away from how the reference plays.
        self.ref, self.ref_kl = None, float(self.cfg.get("refKl") or 0)
        if "ref" in bufs and bufs["ref"].size:
            self.ref = MLP(head["piSizes"], int(head.get("refGru") or 0)).to(self.dev)
            self.ref.load_flat(bufs["ref"])
        # ppo.js's Adam: b1 0.9, b2 0.999, eps 1e-8, bias-corrected; torch's matches.
        self.pi_opt = torch.optim.Adam(self.pi.parameters(), lr=self.cfg["lr"], betas=(0.9, 0.999), eps=1e-8)
        self.vf_opt = torch.optim.Adam(self.vf.parameters(), lr=self.cfg["lr"], betas=(0.9, 0.999), eps=1e-8)
        self.gen = torch.Generator().manual_seed(int(head.get("seed", 0)))

    def logp_ent(self, logits, acts):
        """Sum over heads of log p(chosen) and of each head's entropy."""
        logp = torch.zeros(logits.shape[0], dtype=logits.dtype, device=logits.device)
        ent = torch.zeros_like(logp)
        o = 0
        for h, n in enumerate(self.heads):
            lp = torch.log_softmax(logits[:, o:o + n], dim=1)
            logp = logp + lp.gather(1, acts[:, h:h + 1].long()).squeeze(1)
            ent = ent - (lp.exp() * lp).sum(1)
            o += n
        return logp, ent

    def ref_term(self, logits, ref_lp):
        """Per decision KL(pi || ref), summed over heads. ref_lp: the reference's log-softmax per head."""
        kl, o = torch.zeros(logits.shape[0], dtype=logits.dtype), 0
        for n in self.heads:
            lp = torch.log_softmax(logits[:, o:o + n], dim=1)
            kl = kl + (lp.exp() * (lp - ref_lp[:, o:o + n])).sum(1)
            o += n
        return kl

    def ref_logps(self, obs, eps):
        """The reference's per-head log-softmax for every decision, each match from an empty memory."""
        out = torch.zeros(obs.shape[0], sum(self.heads))
        with torch.no_grad():
            for start, length, _ in eps:
                x = obs[start:start + length]
                lg = self.ref.seq(x.unsqueeze(0), torch.zeros(1, self.ref.gru.hidden_size))[0][0] if self.ref.gru is not None else self.ref(x)
                o = 0
                for n in self.heads:
                    out[start:start + length, o:o + n] = torch.log_softmax(lg[:, o:o + n], dim=1)
                    o += n
        return out

    def minibatch(self, obs, acts, old_logp, adv, ret, idx, ref_lp=None):
        """One minibatch step for both nets. Same objective as ppo.js chunkGrads():
        mean over the minibatch of -min(r*A, clip(r)*A) - entCoef*H, and 0.5*(v-ret)^2."""
        c = self.cfg
        x, a = obs[idx], acts[idx]
        logp, ent = self.logp_ent(self.pi(x), a)
        ratio = torch.exp(logp - old_logp[idx])
        A = adv[idx]
        s1, s2 = ratio * A, torch.clamp(ratio, 1 - c["clip"], 1 + c["clip"]) * A
        pl = -torch.minimum(s1, s2)
        if ref_lp is not None:
            rk = self.ref_term(self.pi(x), ref_lp[idx])
            pl = pl + self.ref_kl * rk
        self.pi_opt.zero_grad(set_to_none=True)
        (pl.mean() - c["entCoef"] * ent.mean()).backward()
        nn.utils.clip_grad_norm_(self.pi.parameters(), c["maxGrad"])
        self.pi_opt.step()
        e = self.vf(x).squeeze(1) - ret[idx]
        vl = 0.5 * e * e
        self.vf_opt.zero_grad(set_to_none=True)
        vl.mean().backward()
        nn.utils.clip_grad_norm_(self.vf.parameters(), c["maxGrad"])
        self.vf_opt.step()
        with torch.no_grad():
            return {"pl": pl.sum().item(), "vl": vl.sum().item(), "ent": ent.sum().item(),
                    "kl": (old_logp[idx] - logp).sum().item(), "clip": (s2 < s1).sum().item(), "n": len(idx),
                    "refKl": (rk.sum().item() if ref_lp is not None else 0.0)}

    def minibatch_seq(self, obs, acts, old_logp, adv, ret, ix, mask, hp, hv, ref_lp=None):
        """minibatch() over pieces of matches. ix [B, L] decision indices (padding points
        at 0), mask [B, L] 1 on real decisions, hp/hv [B, H] the memory each piece starts from."""
        c = self.cfg
        x, flat, m = obs[ix], ix.reshape(-1), mask.reshape(-1)
        n = m.sum()
        logits, _ = self.pi.seq(x, hp)
        logp, ent = self.logp_ent(logits.reshape(flat.numel(), -1), acts[flat])
        ratio = torch.exp(logp - old_logp[flat])
        A = adv[flat]
        s1, s2 = ratio * A, torch.clamp(ratio, 1 - c["clip"], 1 + c["clip"]) * A
        pl = -torch.minimum(s1, s2)
        rk = None
        if ref_lp is not None:
            rk = self.ref_term(logits.reshape(flat.numel(), -1), ref_lp[flat])
            pl = pl + self.ref_kl * rk
        self.pi_opt.zero_grad(set_to_none=True)
        (((pl - c["entCoef"] * ent) * m).sum() / n).backward()
        nn.utils.clip_grad_norm_(self.pi.parameters(), c["maxGrad"])
        self.pi_opt.step()
        v, _ = self.vf.seq(x, hv)
        e = v.reshape(-1) - ret[flat]
        vl = 0.5 * e * e
        self.vf_opt.zero_grad(set_to_none=True)
        ((vl * m).sum() / n).backward()
        nn.utils.clip_grad_norm_(self.vf.parameters(), c["maxGrad"])
        self.vf_opt.step()
        with torch.no_grad():
            return {"pl": (pl * m).sum().item(), "vl": (vl * m).sum().item(), "ent": (ent * m).sum().item(),
                    "kl": ((old_logp[flat] - logp) * m).sum().item(), "clip": ((s2 < s1) * m).sum().item(), "n": int(n.item()),
                    "refKl": (rk * m).sum().item() if rk is not None else 0.0}

    def seq_pass(self, obs, acts, old_logp, eps, fin, N):
        """Every match replayed from an empty memory with the current weights: values
        for GAE, the pieces the epochs train on, and lpErr, the largest gap between the
        log-probability the browser recorded and the one torch gets for the same
        decision (float noise if the two forward passes agree)."""
        L = int(self.cfg.get("seqLen") or 128)
        V, Vfin = np.zeros(N), []
        ix, hp, hv, lp_err, k = [], [], [], 0.0, 0
        z = torch.zeros(1, self.H)
        with torch.no_grad():
            for start, length, trunc in eps:
                x = obs[start:start + length]
                xv = x
                if trunc:
                    xv = torch.cat([x, torch.from_numpy(fin[k:k + 1].copy())]); k += 1
                v, gv = self.vf.seq(xv.unsqueeze(0), z)
                V[start:start + length] = v[0, :length, 0].double().numpy()
                if trunc:
                    Vfin.append(float(v[0, length, 0]))
                logits, gp = self.pi.seq(x.unsqueeze(0), z)
                lp, _ = self.logp_ent(logits[0], acts[start:start + length])
                lp_err = max(lp_err, float((lp - old_logp[start:start + length]).abs().max()))
                for s in range(0, length, L):
                    row = torch.zeros(L, dtype=torch.long)
                    n = min(L, length - s)
                    row[:n] = torch.arange(start + s, start + s + n)
                    ix.append(row)
                    hp.append(gp[0, s - 1] if s else z[0])
                    hv.append(gv[0, s - 1] if s else z[0])
        ix = torch.stack(ix)
        # A piece's padding is the tail the match did not fill: index 0 everywhere but its first slot.
        mask = ((ix > 0) | (torch.arange(L).unsqueeze(0) == 0)).float()
        return V, np.array(Vfin), ix, mask, torch.stack(hp), torch.stack(hv), lp_err

    def update(self, head, b):
        # train.js may change the step size and the KL target per iteration (decaying-change rule).
        if "lr" in head:
            self.cfg["lr"] = float(head["lr"])
            for opt in (self.pi_opt, self.vf_opt):
                for g in opt.param_groups:
                    g["lr"] = self.cfg["lr"]
        if "targetKl" in head:
            self.cfg["targetKl"] = float(head["targetKl"])
        c = self.cfg
        t0 = time.time()
        N, D, H = head["N"], head["D"], head["H"]
        obs = torch.from_numpy(b["obs"].copy()).view(N, D)
        acts = torch.from_numpy(b["acts"].copy()).view(N, H)
        old_logp = torch.from_numpy(b["logps"].copy())
        rews = b["rews"].astype(np.float64)
        eps = head["episodes"]
        fin = b["finalObs"].reshape(-1, D) if b["finalObs"].size else np.zeros((0, D), np.float32)

        # ── Values + GAE (train.js did this with vf.forward in JS) ──
        seq = None
        if self.H:
            V, Vfin, *seq = self.seq_pass(obs, acts, old_logp, eps, fin, N)
        else:
            with torch.no_grad():
                V = self.vf(obs).squeeze(1).double().numpy()
                Vfin = self.vf(torch.from_numpy(fin.copy())).squeeze(1).double().numpy() if len(fin) else np.zeros(0)
        adv = np.zeros(N, np.float64)
        ret = np.zeros(N, np.float64)
        g, lam = c["gamma"], c["lambda"]
        k = 0
        for start, length, trunc in eps:
            nxt = 0.0
            if trunc:
                nxt = Vfin[k]; k += 1
            gae = 0.0
            for t in range(start + length - 1, start - 1, -1):
                delta = rews[t] + g * nxt - V[t]
                gae = delta + g * lam * gae
                adv[t] = gae
                ret[t] = gae + V[t]
                nxt = V[t]
        nadv = (adv - adv.mean()) / (adv.std() + 1e-8)
        adv_t = torch.from_numpy(nadv.astype(np.float32))
        ret_t = torch.from_numpy(ret.astype(np.float32))
        t_gae = time.time() - t0
        ref_lp = self.ref_logps(obs, eps) if self.ref is not None else None

        # ── PPO epochs, full minibatches only, KL early stop after an epoch ──
        mb = c["mb"]
        u = {"pl": 0, "vl": 0, "ent": 0, "kl": 0, "clipFrac": 0, "epochs": 0}
        for ep in range(c["epochs"]):
            s = {"pl": 0, "vl": 0, "ent": 0, "kl": 0, "clip": 0, "n": 0, "refKl": 0}
            if seq:
                ix, mask, hp, hv, _ = seq
                C, cb = ix.shape[0], max(1, mb // ix.shape[1])
                perm = torch.randperm(C, generator=self.gen)
                for a in range(0, C, cb):
                    bi = perm[a:a + cb]
                    if a and len(bi) < cb / 2:
                        break
                    st = self.minibatch_seq(obs, acts, old_logp, adv_t, ret_t, ix[bi], mask[bi], hp[bi], hv[bi], ref_lp)
                    for key in s:
                        s[key] += st[key]
            else:
                perm = torch.randperm(N, generator=self.gen)
                for a in range(0, N - mb + 1, mb):
                    st = self.minibatch(obs, acts, old_logp, adv_t, ret_t, perm[a:a + mb], ref_lp)
                    for key in s:
                        s[key] += st[key]
            n = max(1, s["n"])
            u = {"pl": s["pl"] / n, "vl": s["vl"] / n, "ent": s["ent"] / n, "kl": s["kl"] / n,
                 "clipFrac": s["clip"] / n, "epochs": ep + 1, "refKl": s["refKl"] / n}
            if u["kl"] > c["targetKl"] * 1.5:
                break
        if seq:
            u["lpErr"] = seq[4]
        u["tGae"] = round(t_gae * 1000)
        u["tPy"] = round((time.time() - t0) * 1000)
        return u


def main():
    tr = None
    while True:
        try:
            head, b = recv()
        except EOFError:
            return
        t = head["type"]
        if t == "init":
            tr = Trainer(head, b)
            log(f"torch {torch.__version__}, pi {tr.pi.sizes}, vf {tr.vf.sizes}, threads {torch.get_num_threads()}")
            send({"ok": True, "device": str(tr.dev), "torch": torch.__version__})
        elif t == "update":
            u = tr.update(head, b)
            send({"upd": u}, [("pi", tr.pi.flat()), ("vf", tr.vf.flat())])
        elif t == "step":
            N, D, H = head["N"], head["D"], head["H"]
            st = tr.minibatch(torch.from_numpy(b["obs"].copy()).view(N, D), torch.from_numpy(b["acts"].copy()).view(N, H),
                              torch.from_numpy(b["logps"].copy()), torch.from_numpy(b["adv"].copy()),
                              torch.from_numpy(b["ret"].copy()), torch.from_numpy(b["idx"].astype(np.int64)))
            send({"st": st}, [("pi", tr.pi.flat()), ("vf", tr.vf.flat())])
        elif t == "seq":
            with torch.no_grad():
                x = torch.from_numpy(b["obs"].copy()).view(1, head["T"], head["D"])
                z = torch.zeros(1, tr.H)
                send({}, [("logits", tr.pi.seq(x, z)[0].reshape(-1).numpy()), ("v", tr.vf.seq(x, z)[0].reshape(-1).numpy())])
        elif t == "weights":
            send({}, [("pi", tr.pi.flat()), ("vf", tr.vf.flat())])
        else:
            send({"error": f"unknown message {t}"})


if __name__ == "__main__":
    main()
