# 🚚 Fleet Route Optimizer — VRPTW Solver & Cost-to-Serve Engine

Mathematical route optimization solver, constraint validator, and financial cost-to-serve analytics engine for the Supply Chain Workspace.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/Node.js-24_LTS-green?logo=node.js)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-black?logo=express)](https://expressjs.com)
[![Port](https://img.shields.io/badge/Port-8200-blue)](http://localhost:8200)
[![Tests Passing](https://img.shields.io/badge/tests-16%2F16_passed-brightgreen.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 🎯 Overview

`fleet-route-optimizer` provides automated constraint optimization and predictive cost modeling for last-mile logistics and regional transport:

- **Constraint Optimization (VRPTW)**: Vehicle Routing Problem with Time Windows solving customer delivery sequences subject to capacity, shift lengths, time windows, and service durations.
- **Dual Solver Architecture**: Baseline Greedy Insertion vs. Metaheuristic 2-Opt local search.
- **Independent Constraint Validation**: Hard constraint verification validating that no vehicle exceeds volumetric capacity or violates strict delivery windows.
- **Financial Cost-to-Serve Modeling**: Multi-seed Monte Carlo simulation accounting for driver wages, fuel consumption per kilometer, maintenance overhead, and delayed delivery SLA penalty costs.

---

## 🔒 Contract Boundaries & Operational Invariants

As mandated by `AGENTS.md`:
- **Zero Operational Write Access**: Solvers operate on immutable, tenant-scoped planning snapshots (`DATA-02`) and directed routing matrices (`ROUTE-01`).
- **No Direct Database Writes**: Results are returned via typed JSON response contracts, never written directly into operational PostgreSQL tables.
- **Deterministic Evaluation**: Re-running scenarios with identical random seeds produces bit-identical cost and route schedules.

---

## 🔌 HTTP API Endpoints (Port 8200)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service health status, uptime, and engine version |
| `POST` | `/api/v1/optimize` | Executes VRPTW solver given customer stops, fleet vehicles, and directed travel-time matrix |
| `POST` | `/api/v1/evaluate` | Evaluates financial cost-to-serve metrics and Monte Carlo variance across dispatch plans |

---

## 🚀 Getting Started

### Installation & Build
```bash
pnpm install
pnpm build
```

### Running Test Suite (16/16 Unit & Scenario Tests)
```bash
pnpm test
```

### Starting the Solver Service
```bash
pnpm dev
```
Listens on **[http://localhost:8200](http://localhost:8200)**.

---

## 📄 License
MIT License.
