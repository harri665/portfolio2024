---
title: AI Traffic Lights
tagline: The traffic lights in my town frustrated me, so I built a small city where every light learns when to change.
role: Solo. Final project for my AI/ML class
timeline: Apr 2026
stack:
  - C
  - OpenGL
  - GLFW
  - Q-learning (from scratch)
  - A* pathfinding
cover: aitraffic-rl.webp
published: true
---
The traffic lights in my town frustrated me, and I figured even a simple AI model could do better. So for my AI/ML final project I built a city to test it: a 5×5 grid of intersections, up to 300 cars driving across it, and a learning agent running each light. Each agent watches how many cars are lined up in each direction and decides whether to keep the green or switch.

It did do better. With the learning lights, a car waits 4.7 seconds at a light on average. The best fixed timer I could find averages 6.3 seconds, and the default 8-second timer averages 19.

![[aitraffic-rl-anim.webp]]

## How it works

I wrote the whole thing in C with no libraries because I wanted to understand all of it: the simulation, the pathfinding, the rendering, and the learning.

**The city.** Cars spawn at the edges with a random destination on another edge and plan a route with A* when they spawn. The spawn rate goes up and down on a rush-hour cycle, 8% of cars are slower buses, and 4% are emergency vehicles that run red lights. A car stopped at a red light adds to its wait time until the light turns green.

**The agents.** Every intersection has its own Q-learning agent, and each one is just a table. Its state is the number of cars queued in each of the four directions, grouped into 0, 1–2, 3–5 and 6+, plus which way is currently green. That comes to 512 states. It has two actions: keep the green, or switch (through yellow first). It gets penalised for every car waiting and rewarded for every car that makes it through:

$$r = -1.0 \cdot \text{waiting} + 0.5 \cdot \text{cleared}$$

I also added two things from deep Q-learning to keep training stable: a replay buffer of past decisions to learn from, and a frozen copy of the table used for targets, synced every 20 decisions.

## Measuring it properly

The writeup I turned in for class said the agents got waits of "around 3.5–5 seconds vs 6.5–7.5 seconds for fixed," and that came from watching the console for a few minutes. That isn't a real measurement. The numbers bounce around with the rush-hour cycle, a few minutes is one random draw, and the speed-up keys change the timestep, which changes the physics.

So I went back and wrote a headless version that runs the same simulation code with no window, at a fixed timestep, across 8 random seeds. The whole comparison runs in under 6 seconds, so I could just test a change instead of guessing whether it helped.

I also had to check the metric itself. "Average wait" only counts cars that finish their trip. If a controller gridlocks part of the city, the stuck cars never finish and never get counted, so the average would look *better*. The harness tracks trips completed per hour and total time spent waiting, including cars still on the road. Every setup below completed the same number of trips (about 18,000 an hour), so the comparison is fair.

After 2 simulated hours of training, the agents cut the average wait by 40% against the 8-second timer:

| | average wait |
|---|---|
| Fixed timer, 8 s green | 19.0 s |
| Q-learning, decides every 8 s | 11.4 s |

The agents start out much worse than the timer, since switching at random is terrible, and pass it after about 10 simulated minutes:

![[aitraffic-learning.webp]]

## Then I tuned the timer

The 8-second green was just a number I picked when I wrote the simulation. When I tried shorter ones, the timer kept getting better:

| fixed green | average wait |
|---|---|
| 12 s | 28.1 s |
| 8 s (default) | 19.0 s |
| 4 s | 10.4 s |
| 2 s | 7.3 s |
| 1 s | **6.3 s** |

A timer switching every second beat my agents by almost half. They hadn't learned anything clever about traffic. They were beating a badly tuned timer by switching more often, and deciding only every 8 seconds kept them from switching as often as the tuned timer does. Once I let them decide more often, they won again:

| agents decide every | average wait | vs best fixed timer (6.3 s) |
|---|---|---|
| 8 s | 11.4 s | 80% worse |
| 4 s | 6.4 s | about even |
| 2 s | **4.7 s** | **26% better** |

![[aitraffic-results.webp]]

26% is a smaller number than 40%, but it's one I can actually stand behind.

## What it doesn't capture

Real roads are a lot more complicated than this. Every road here is the same length, the city is a perfect grid, and every intersection is a four-way. I put in as much as I could, but a simulation like this can only tell you so much about a real town.

The biggest gap is that changing the light costs nothing here. When a light turns green, the waiting cars are moving at full speed instantly. Real intersections lose a couple of seconds every time the light changes, which is why real cycles are long. That's why a 1-second timer wins in my simulation, and it would never work on a real street.

## What I'd do differently

- **Build the measurement first.** I added buses, emergency vehicles and a live graph before I had any trustworthy way to measure anything. The headless version took about an hour and changed the conclusion.
- **Tune the baseline as hard as the model.** If I'd spent as much time on the fixed timer as on the replay buffer, I'd have found the decision-interval problem on day one.
- **Make switching cost something.** Start-up delay and a minimum green time would make the problem realistic, and could change which controller wins.
- **Let intersections talk to each other.** Each agent only sees its own four queues. Green waves down a street need neighbours to coordinate.
- **Build an actual city.** Roads of different lengths and a real layout instead of a grid, to see whether the agents still hold up.

The code is on [GitHub](https://github.com/harri665/AITraffic), and the README explains how to run the evaluation.
