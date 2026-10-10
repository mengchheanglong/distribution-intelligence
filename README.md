# Fleet Route Optimizer — VRPTW Solver & Cost-to-Serve Engine

`fleet-route-optimizer` is the mathematical route optimization solver and cost-to-serve worker for the Supply Chain Workspace.

## Ownership & Scope
- **Owner**: `fleet-route-optimizer` (separate Git repository).
- **Purpose**: Constraint optimization (VRPTW), fleet route scheduling, baseline vs. metaheuristic evaluation.
- **Contract Boundary**: Consumes read-only immutable planning snapshots (`DATA-02`) and directed routing matrices (`ROUTE-01`).
- **Isolation**: Simulation and optimization workers never receive operational write credentials.
- **Milestones**:
  - `OPT-01`: VRPTW solver engine, greedy baseline comparator, independent constraint validator (capacities, time windows, shift limits, service durations).
  - `EVAL-01`: Historical baseline reconstruction, explicit cost-to-serve models, held-out evaluation.
