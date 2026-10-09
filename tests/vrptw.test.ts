import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SnapshotProblemAdapter,
  GreedyVrpSolver,
  MetaheuristicVrpOptimizer,
  ConstraintValidator,
  PlanComparator,
} from '../src/index.js';

describe('OPT-01: VRPTW Solvers & Plan Comparator', () => {
  // Setup 10 delivery orders across Phnom Penh
  const facilities = [
    {
      id: 'depot-central',
      code: 'DEPOT-PNH-01',
      name: 'Phnom Penh Central Distribution Center',
      latitude: 11.5564,
      longitude: 104.9282,
    },
  ];

  const orders = [
    { id: 'ord-01', orderNumber: 'SO-1001', status: 'pending', deliveryLatitude: 11.5600, deliveryLongitude: 104.9150, totalWeightGrams: 2000 },
    { id: 'ord-02', orderNumber: 'SO-1002', status: 'pending', deliveryLatitude: 11.5650, deliveryLongitude: 104.9220, totalWeightGrams: 3000 },
    { id: 'ord-03', orderNumber: 'SO-1003', status: 'pending', deliveryLatitude: 11.5720, deliveryLongitude: 104.9180, totalWeightGrams: 4000 },
    { id: 'ord-04', orderNumber: 'SO-1004', status: 'pending', deliveryLatitude: 11.5800, deliveryLongitude: 104.9300, totalWeightGrams: 1000 },
    { id: 'ord-05', orderNumber: 'SO-1005', status: 'pending', deliveryLatitude: 11.5750, deliveryLongitude: 104.8980, totalWeightGrams: 5000 },
    { id: 'ord-06', orderNumber: 'SO-1006', status: 'pending', deliveryLatitude: 11.5435, deliveryLongitude: 104.9142, totalWeightGrams: 2000 },
    { id: 'ord-07', orderNumber: 'SO-1007', status: 'pending', deliveryLatitude: 11.5510, deliveryLongitude: 104.9350, totalWeightGrams: 3000 },
    { id: 'ord-08', orderNumber: 'SO-1008', status: 'pending', deliveryLatitude: 11.5380, deliveryLongitude: 104.9260, totalWeightGrams: 2000 },
    { id: 'ord-09', orderNumber: 'SO-1009', status: 'pending', deliveryLatitude: 11.5620, deliveryLongitude: 104.9400, totalWeightGrams: 4000 },
    { id: 'ord-10', orderNumber: 'SO-1010', status: 'pending', deliveryLatitude: 11.5480, deliveryLongitude: 104.9050, totalWeightGrams: 3000 },
  ];

  const problem = SnapshotProblemAdapter.fromSnapshotData({
    snapshotId: 'snap-20261009-01',
    tenantId: 'tenant-kh-express',
    facilities,
    orders,
    fleetSize: 4,
  });

  it('solves problem using GreedyVrpSolver and passes independent validation', () => {
    const greedyResult = GreedyVrpSolver.solve(problem);

    assert.equal(greedyResult.status, 'FEASIBLE');
    assert.equal(greedyResult.unassignedStops.length, 0);
    assert.ok(greedyResult.routes.length > 0);
    assert.ok(greedyResult.objectiveCostCents > 0);

    // Validate with independent constraint validator
    const report = ConstraintValidator.validatePlan(problem, greedyResult);
    assert.equal(report.isValid, true);
    assert.equal(report.violations.length, 0);
  });

  it('solves problem using MetaheuristicVrpOptimizer with improved objective and zero violations', () => {
    const greedyResult = GreedyVrpSolver.solve(problem);
    const optimizedResult = MetaheuristicVrpOptimizer.solve(problem, { maxIterations: 100 });

    assert.ok(['FEASIBLE', 'OPTIMAL'].includes(optimizedResult.status));
    assert.equal(optimizedResult.unassignedStops.length, 0);

    // Metaheuristic cost must be <= greedy baseline cost
    assert.ok(
      optimizedResult.objectiveCostCents <= greedyResult.objectiveCostCents,
      `Optimized cost ${optimizedResult.objectiveCostCents} should be <= greedy cost ${greedyResult.objectiveCostCents}`
    );

    // Independent validator must verify 100% feasibility
    const report = ConstraintValidator.validatePlan(problem, optimizedResult);
    assert.equal(report.isValid, true);
    assert.equal(report.violations.length, 0);

    // Compare plans
    const comparison = PlanComparator.compare(problem, greedyResult, optimizedResult);
    assert.equal(comparison.baselineValid, true);
    assert.equal(comparison.optimizedValid, true);
    assert.ok(comparison.costSavingsPercent >= 0);
    assert.ok(comparison.summary.includes('Fleet Plan Optimization Comparison'));
  });

  it('detects infeasibility when customer demand exceeds vehicle capacity', () => {
    // Single order demanding 25 units where max vehicle capacity is 15
    const infeasibleOrders = [
      { id: 'ord-huge', orderNumber: 'SO-9999', status: 'pending', deliveryLatitude: 11.5600, deliveryLongitude: 104.9150, totalWeightGrams: 25000 },
    ];

    const infeasibleProblem = SnapshotProblemAdapter.fromSnapshotData({
      snapshotId: 'snap-infeasible-1',
      tenantId: 'tenant-kh-express',
      facilities,
      orders: infeasibleOrders,
      fleetSize: 2,
    });

    const greedyResult = GreedyVrpSolver.solve(infeasibleProblem);
    assert.equal(greedyResult.status, 'INFEASIBLE');
    assert.equal(greedyResult.unassignedStops.length, 1);
    assert.equal(greedyResult.unassignedStops[0].stopId, 'stop-ord-huge');
  });
});
