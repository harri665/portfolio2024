---
title: My Traffic AI Beat the Baseline. Then I Tuned the Baseline.
date: '2026-09-30'
tags:
  - code
  - simulation
  - machine-learning
description: >-
  Q-learning traffic lights cut average wait by 40%, until a 1-second fixed
  timer beat them. What a headless evaluation harness, 8 seeds and one honest
  baseline changed about the result.
cover: aitraffic-rl.webp
published: false
---

# My Traffic AI Beat the Baseline. Then I Tuned the Baseline.

This started as a course project: a traffic simulation in C with OpenGL, where every intersection's lights are run by a reinforcement-learning agent instead of a timer. The writeup I handed in said the learned lights got average waits of "around 3.5–5 seconds vs 6.5–7.5 seconds for fixed," based on watching the console for a few minutes. Months later I went back to measure it properly. The headline survived, but not for the reason I thought, and the process of finding out is the more useful story.

![[aitraffic-rl-anim.webp]]

---

## The simulation

A 5×5 grid of intersections, 2 units apart. Cars spawn at the edges with a random destination on another edge and plan a route with A* (Manhattan heuristic) when they spawn. The spawn rate follows a sinusoidal rush-hour cycle between 1× and 2.5× over two simulated minutes, and up to 300 cars can be active. 8% are buses (slower) and 4% are emergency vehicles, which run red lights.

A car approaching a red light stops at the edge of the intersection and accumulates `wait_time` until it turns green. When it reaches its destination, its wait and travel time are added to the totals. That detail matters later.

The baseline is a fixed timer: 8 seconds of green per direction, 1.5 seconds of yellow.

---

## The agents

Each intersection gets its own tabular Q-learner. No neural network and no libraries, just a table.

**State.** Queue lengths in each of the four directions, binned into 0 / 1–2 / 3–5 / 6+, plus which axis currently has green:

$$4^4 \times 2 = 512 \text{ states}$$

**Actions.** Keep the current phase, or switch (which goes through yellow first).

**Reward.** Negative cars waiting, plus a bonus for cars that cleared the intersection since the last decision:

$$r = -1.0 \cdot \text{waiting} + 0.5 \cdot \text{cleared}$$

**Update.** Standard Q-learning,

$$Q(s,a) \leftarrow Q(s,a) + \alpha\left[r + \gamma \max_{a'} Q_{\text{target}}(s', a') - Q(s,a)\right]$$

with $\alpha = 0.2$, $\gamma = 0.95$, and two stabilisers borrowed from DQN: a replay buffer of 2000 transitions sampled in batches of 32, and a frozen copy of the table for TD targets, synced every 20 decisions. Exploration starts at $\varepsilon = 0.3$ and decays by 0.995 per decision to a floor of 0.05.

One decision every 8 seconds, matching the fixed cycle. That seemed like the fair choice at the time.

---

## Step 1: stop eyeballing the console

The app prints stats every 10 simulated seconds, and that is what I'd been looking at. Three problems with that: the numbers bounce around with the rush-hour cycle, a few minutes is one random draw, and the speed-up keys multiply the timestep, which changes the physics you're measuring.

So I wrote a headless harness. It links the project's `simulation.c`, `pathfinding.c` and `rl_agent.c` unchanged, with no window and no rendering, and runs each configuration for a fixed simulated time at a fixed `dt = 0.05`, across 8 random seeds:

```c
static Result run(int use_rl, unsigned seed, double train_s, double eval_s)
{
    srand(seed);
    sim_init(&sim);
    sim.use_rl = use_rl;
    for (long i = 0; i < train_s / dt; i++) sim_update(&sim, dt);  /* train / warm up */

    int done0 = sim.total_completed; double wait0 = sim.total_wait;
    for (long i = 0; i < eval_s / dt; i++) {
        sim_update(&sim, dt);
        /* also count cars waiting right now, finished or not, and
           whether all 300 slots are full */
    }
    ...
}
```

The whole sweep (8 seeds × 2 modes × 3 simulated hours) runs in under 6 seconds. That alone changes how you work: you stop arguing with yourself about whether a change helped and just run it.

---

## Step 2: check the metric can't lie

"Average wait" in this simulation means *average wait of cars that finished their trip*. That has a failure mode: if a controller gridlocks part of the city, the stuck cars never finish, never get counted, and the average looks **better**. The 300-car cap makes it worse, because once every slot is full, new cars just aren't spawned, and demand quietly disappears.

So the harness also records throughput (trips completed per hour), the total vehicle-hours spent waiting including cars that haven't finished, the mean number of active cars, and the fraction of time the cap is hit.

For every configuration below, throughput was identical (about 18,000 trips an hour, which is the demand) and the cap was never hit. So the average-wait comparison is fair, and the vehicle-hours numbers tell the same story. But I only know that because I checked.

---

## Step 3: the result

After 2 hours of simulated training, measured over the next hour:

| | average wait | vehicle-hours waiting per hour |
|---|---|---|
| Fixed timer, 8 s green | 19.0 s | 95 |
| Q-learning, decides every 8 s | 11.4 s | 57 |

**40% less waiting**, consistent across all 8 seeds (the per-seed spread was about ±0.3 s). The learning curve looks right too: untrained agents are much worse than the timer, because random switching is terrible, and they pass it within about 10 simulated minutes:

![[aitraffic-learning.webp]]

This is where I would have stopped before.

---

## Step 4: tune the baseline

The fixed timer's 8 seconds was a number I picked when I wrote the simulation. Nobody had tuned it. So I swept it:

| fixed green | average wait |
|---|---|
| 12 s | 28.1 s |
| 8 s (default) | 19.0 s |
| 6 s | 14.4 s |
| 4 s | 10.4 s |
| 3 s | 8.5 s |
| 2 s | 7.3 s |
| 1 s | **6.3 s** |

*(Mean of 4 seeds for 3 s and up, 8 seeds for the rest; seeds agreed to within a few tenths of a second.)*

A 1-second green beats the learned agents by almost half. The "AI" had not learned anything clever about traffic. It was beating a badly tuned timer by switching more often than the timer did, and the 8-second decision interval I gave it meant it couldn't switch often enough to find what the timer does when it's tuned.

Let the agents decide as often as the tuned timer switches:

| agents decide every | average wait | vs best fixed timer (6.3 s) |
|---|---|---|
| 8 s | 11.4 s | 80 % worse |
| 4 s | 6.4 s | about even |
| 2 s | **4.7 s** | **26 % better** |

![[aitraffic-results.webp]]

So the learned controller does win, by 26% against the best fixed timer I could find. That is a smaller claim than 40%, and a much more defensible one.

---

## Why a 1-second green wins (and why that's suspicious)

In this simulation, a car at a green light is moving at full speed the instant the light changes. There is no start-up delay, no minimum green, and no all-red clearance interval. Real intersections lose a couple of seconds every time the phase changes, which is exactly why real cycles are long. Here, switching is nearly free, so the optimal fixed policy is "switch constantly."

That doesn't invalidate the comparison, since both controllers play by the same rules, but it tells me what to fix before trusting any of it: add start-up lost time and a minimum green, and the best timer, the best decision interval, and possibly the winner will all move.

---

## What I'd do differently

**Build the harness before the features.** The emergency vehicles, buses and sparkline graph were all written before I had a trustworthy way to measure anything. The harness took an hour and changed the conclusion.

**Tune the baseline as hard as the model.** If I'd spent the same effort on the fixed timer as on the replay buffer, I would have found the decision-interval issue on day one.

**Model the cost of switching.** Without start-up delay, the problem is too easy to be interesting.

**Let intersections talk.** The header comment in `rl_agent.c` promises a "4-bit neighbour congestion mask" in the state. The state never got it: each agent sees only its own four queues. Green waves need neighbours.

---

## References

- Watkins & Dayan, *Q-learning*, Machine Learning 8, 1992
- Mnih et al., *Human-level control through deep reinforcement learning*, Nature 2015, for experience replay and target networks
- Webster, *Traffic Signal Settings*, Road Research Technical Paper No. 39, 1958, the classic treatment of lost time and optimal cycle length

*Code on [GitHub](https://github.com/harri665/AITraffic). The evaluation harness is in the README.*
