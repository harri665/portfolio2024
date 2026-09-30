---
title: AI Traffic Lights
tagline: Q-learning traffic signals that cut average wait by 26% against the best fixed timer I could tune, and by 40% against the default one, measured over 8 seeds.
role: Solo. Simulation, reinforcement learning, rendering, evaluation
timeline: Apr 2026
stack:
  - C
  - OpenGL
  - GLFW
  - Q-learning (from scratch)
  - A* pathfinding
blog: https://blog.harrison-martin.com/tune-your-baseline
cover: aitraffic-rl.webp
published: true
---
A 5×5 city grid of intersections, with up to 300 cars routing across it by A* through a rush-hour demand cycle. Each intersection is run by its own Q-learning agent that watches its queues and decides whether to keep or switch the green. Everything is written in C with no ML libraries, and a fast-training mode skips rendering so the agents learn in minutes.

![[aitraffic-rl-anim.webp]]

## Result

The first comparison looked great: learned lights beat the 8-second timer by 40%. Then I tuned the timer. A 1-second green cut its wait by two thirds, and the dumb timer now beat the learned lights. The agents only won again once they were allowed to decide as often as the tuned timer switches.

![[aitraffic-results.webp]]

## Key decisions

- **Built a headless evaluation harness** that links the simulation without rendering and runs 8 seeds per configuration. It records throughput and cars stuck in the network alongside wait time, because a controller that gridlocks the grid can look *better* on "average wait of finished trips".
- **Tuned the baseline before claiming a win.** The biggest lever turned out to be how often the agents may act, not the learning algorithm.
- **Kept the state small:** four queue lengths binned into four levels, plus the current phase, gives 512 states. Experience replay and a periodically synced target table keep the learning stable.

## Outcome

Agents start out worse than the default timer (36.7 s), pass it after about 10 simulated minutes of training, and settle within an hour. With 2-second decisions they reach **4.7 s** average wait, against **6.3 s** for the best fixed timer and **19.0 s** for the default.
