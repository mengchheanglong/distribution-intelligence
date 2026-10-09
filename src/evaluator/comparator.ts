/**
 * @fileoverview Plan comparator and report generator.
 *
 * Compares two fleet plans (e.g. Greedy Baseline vs. Metaheuristic Optimizer)
 * evaluating vehicle utilization, total kilometers, driving hours, cost savings,
 * and verifying that both plans satisfy all operational constraints.
 */

import { ProblemDefinition, OptimizationResult, PlanComparison } from '../types/index.js';
import { ConstraintValidator } from '../validator/index.js';

export class PlanComparator {
  public static compare(
    problem: ProblemDefinition,
    baseline: OptimizationResult,
    optimized: OptimizationResult
  ): PlanComparison {
    const baseValid = ConstraintValidator.validatePlan(problem, baseline).isValid;
    const optValid = ConstraintValidator.validatePlan(problem, optimized).isValid;

    const deltaCostCents = baseline.objectiveCostCents - optimized.objectiveCostCents;
    const costSavingsPercent =
      baseline.objectiveCostCents > 0
        ? Math.round((deltaCostCents / baseline.objectiveCostCents) * 1000) / 10
        : 0;

    const deltaVehicles = baseline.summary.totalVehiclesUsed - optimized.summary.totalVehiclesUsed;
    const deltaDistanceKm =
      Math.round((baseline.summary.totalDistanceKm - optimized.summary.totalDistanceKm) * 100) / 100;
    const deltaDrivingHours =
      Math.round((baseline.summary.totalDrivingHours - optimized.summary.totalDrivingHours) * 100) / 100;

    const summary = [
      `=== Fleet Plan Optimization Comparison ===`,
      `Problem ID           : ${problem.id}`,
      `Baseline Algorithm   : ${baseline.algorithm} (Cost: $${(baseline.objectiveCostCents / 100).toFixed(2)})`,
      `Optimized Algorithm  : ${optimized.algorithm} (Cost: $${(optimized.objectiveCostCents / 100).toFixed(2)})`,
      `Vehicles Reduced     : ${deltaVehicles} (${baseline.summary.totalVehiclesUsed} -> ${optimized.summary.totalVehiclesUsed})`,
      `Distance Saved       : ${deltaDistanceKm} km`,
      `Driving Hours Saved  : ${deltaDrivingHours} h`,
      `Total Cost Savings   : $${(deltaCostCents / 100).toFixed(2)} (${costSavingsPercent}%)`,
      `Constraint Validity  : Baseline Valid=${baseValid}, Optimized Valid=${optValid}`,
    ].join('\n');

    return {
      baselineAlgorithm: baseline.algorithm,
      optimizedAlgorithm: optimized.algorithm,
      deltaCostCents,
      costSavingsPercent,
      deltaVehicles,
      deltaDistanceKm,
      deltaDrivingHours,
      baselineValid: baseValid,
      optimizedValid: optValid,
      summary,
    };
  }
}
