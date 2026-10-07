# Machines

> **Why this file exists.** This project is worked on from **two different
> machines** with very different capabilities. Assuming the wrong one is not a
> cosmetic mistake: it is how a session ends up claiming a `npm test` result it
> never obtained, or spending an hour debugging a Docker sandbox on a host where
> the daemon is unreachable. **Run the probe before you claim anything.**

The probe is the source of truth, not this table:

```sh
sh scripts/env-probe.sh            # full report
sh scripts/env-probe.sh --brief    # identity + the essentials
```

`machine-id` (first 8 chars of `/etc/machine-id`) is the unambiguous
fingerprint — hostnames get reused, hardware gets upgraded.

---

## A — Build machine

**Status: not yet profiled.** ⚠️ `VERIFICATION REQUIRED` — I have no access to
this machine, so nothing about it is written here that I did not verify.

The owner describes it as *"a machine that has support for everything"*. That is
a **report, not a measurement**, and it is not specific enough to plan around.
Fill this in by running, on that machine:

```sh
sh scripts/env-probe.sh
```

| Field | Value |
| --- | --- |
| `machine-id` | _(run the probe)_ |
| Hostname | _(run the probe)_ |
| OS / kernel | _(run the probe)_ |
| CPU / RAM | _(run the probe)_ |
| `node` / `npm` | _(run the probe)_ |
| `cargo` / `rustc` | _(run the probe)_ |
| Docker daemon | _(run the probe)_ |
| WebKitGTK runtime | _(run the probe)_ |
| `ollama` + models | _(run the probe)_ |

**Do not guess these.** Paste the probe output; it is already formatted.

---

## B — Notebook, `juju-hppaviliong4notebookpc`

**Profiled 2026-10-07** by running `scripts/env-probe.sh` on it.

| Field | Value |
| --- | --- |
| `machine-id` | `3e798a6d` |
| Hostname | `juju-hppaviliong4notebookpc` |
| OS / kernel | Ubuntu 25.10 (Questing Quokka) · Linux 6.17.0-41-generic · x86_64 |
| CPU / RAM | AMD A4-3300M APU, **2 cores** · 5,3 GB · 49 GB free |
| `node` / `npm` / `npx` | **ABSENT** (no nvm/volta/fnm/snap; apt offers Node 20, below the `>=22` floor) |
| `cargo` / `rustc` | **ABSENT** (no `~/.cargo`) |
| Docker | **29.7.2, daemon WORKS** — native `/var/lib/docker`, user in the `docker` group |
| WebKitGTK 4.1 + GTK 3 | **present** — a Tauri window opens |
| `ollama` | **0.35.1 running** · `deepseek-r1:1.5b` (local, 1.1 GB) + one cloud model |
| Other | `python3` 3.13.7 · `git` 2.51.0 · `jq` 1.8.1 · `curl` 8.14.1 |
| `sudo` | needs a password — no non-interactive privilege escalation |
| Display | `X11=:0`, no Wayland |

### Verdict for B

| Can | Cannot |
| --- | --- |
| read and write code, commit, push | **build** (`lint`/`typecheck`/`test`/`build`) |
| follow CI results on GitHub | **compile the Rust shell** (`cargo`) |
| **run the packaged app** (WebKitGTK present) | install system packages (`sudo` needs a password) |
| **exercise the agent against a real model** (ollama present) | run the *tests* of the sandbox (no Node) |
| **run the Docker sandbox** (daemon works — verified live) | anything needing ≥ 3 cores or a GPU |
| validate YAML/`bash -n` (python3 + PyYAML) | |

One consequence that keeps biting:

**It is not a build machine.** GitHub Actions is the only compiler. A green
local-looking claim that was never executed is worse than saying "not verified
here".

What *changed* on 2026-10-07: adding the user to the `docker` group turned the
sandbox from "installed but denied" into "usable", so the sandbox can now be
**verified live on B** — not through `npm test` (still no Node), but by running
the exact argv the sandbox builds. That is how item 27's `no-new-privileges`
limitation was found **not** to reproduce here; see `PROJECT_STATE.md` §3 item 30
for the measurement and what it does and does not settle.

The weak CPU bounds the agent's usefulness: a local model runs, but slowly.
That is a reason to prefer small models here and to keep agent turns short, not
a reason to skip exercising the loop at all — a slow real model still reveals
what no stub does (that is how §3 items 19–20 were found).

---

## The rule

**Whosever machine can execute a check is the one that reports it.**

- On **B**: build, test and Docker verification are **delegated to CI**. Read the
  run, quote the annotation, and say plainly that it ran on GitHub and not here.
- On **A**: the local loop is authoritative; run it before pushing.
- On **either**: `sh scripts/env-probe.sh` first, every session, because the
  machine you are on is the one thing you must not assume.
