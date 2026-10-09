/**
 * @fileoverview Scenario Evaluator and Projected vs. Realized Comparator.
 *
 * Provides comprehensive evaluation across 3 operational tracks:
 * 1. Historical Actual: Field ground truth observed from historical execution.
 * 2. Greedy Baseline: Standard dispatching rule heuristic.
 * 3. Optimized Plan: Metaheuristic VRP solver.
 *
 * Implements rigorous statistical evaluation:
 * - Common Random Numbers (CRN) using seeded PRNG across multi-seed simulation iterations.
 * - Monte Carlo Confidence Intervals (95% CI) over realized costs and savings.
 * - Explicit separation between theoretical solver projections and expected realized outcomes.
 * - SLA breach probability under operational variance (traffic/dwell uncertainty).
 */

import {
  ProblemDefinition,
  OptimizationResult,
  HistoricalTrip,
  CostModelParameters,
  EvaluationReport,
  ScenarioEvaluationTrack,
  MonteCarloConfidenceInterval,
} from '../types/index.js';
import { FinancialCostModel, DEFAULT_COST_PARAMETERS } from '../financial/cost-model.js';
import { HistoricalReconstructor } from './historical-reconstructor.js';

export interface EvaluationOptions {
  costParams?: Partial<CostModelParameters>;
  simulationSeeds?: number[];
  stochasticTrafficVariance?: number; // e.g. 0.15 (+/- 15% traffic noise)
  stochasticDwellVariance?: number;   // e.g. 0.20 (+/- 20% dwell noise)
}

/**
 * Seeded Mulberry32 pseudo-random number generator for Common Random Numbers (CRN).
 */
class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  public next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns normal-distributed random perturbation around 1.0 */
  public perturb(variance: number): number {
    // Uniform between (1 - variance) and (1 + variance)
    const factor = 1 - variance + this.next() * (2 * variance);
    return Math.max(0.5, factor);
  }
}

export class ScenarioComparator {
  /**
   * Evaluates and compares Historical Actual vs Greedy Baseline vs Optimized Plan.
   */
  public static evaluate(
    problem: ProblemDefinition,
    historicalTrips: HistoricalTrip[],
    greedyResult: OptimizationResult,
    optimizedResult: OptimizationResult,
    options: EvaluationOptions = {}
  ): EvaluationReport {
    const costParams: CostModelParameters = {
      ...DEFAULT_COST_PARAMETERS,
      ...(options.costParams || {}),
    };

    const seeds = options.simulationSeeds || [42, 101, 202, 303, 404, 505, 606, 707, 808, 909];
    const trafficVariance = options.stochasticTrafficVariance ?? 0.15;
    const dwellVariance = options.stochasticDwellVariance ?? 0.20;

    // Track 1: Historical Actual
    const histBaseline = HistoricalReconstructor.reconstructBaseline(
      historicalTrips,
      'Historical-Ground-Truth',
      costParams
    );

    const histTrack: ScenarioEvaluationTrack = {
      trackName: 'HISTORICAL_ACTUAL',
      algorithm: 'Recorded Field Operations',
      vehiclesCount: histBaseline.totalVehiclesUsed,
      distanceKm: histBaseline.totalDistanceKm,
      shiftHours: histBaseline.totalShiftHours,
      onTimePercent: histBaseline.onTimePercent,
      projectedCostCents: histBaseline.financialBreakdown.totalCostCents,
      costBreakdown: histBaseline.financialBreakdown,
    };

    // Track 2: Greedy Baseline
    const greedyBreakdown = FinancialCostModel.calculateForPlan(
      greedyResult.routes,
      greedyResult.unassignedStops,
      costParams
    );
    const greedySims = this.simulateRealizations(
      greedyResult,
      seeds,
      trafficVariance,
      dwellVariance,
      costParams
    );
    const greedyTrack: ScenarioEvaluationTrack = {
      trackName: 'GREEDY_BASELINE',
      algorithm: greedyResult.algorithm,
      vehiclesCount: greedyBreakdown.vehiclesDeployed,
      distanceKm: greedyBreakdown.totalDistanceKm,
      shiftHours: greedyBreakdown.totalShiftHours,
      onTimePercent: greedyResult.summary.slaCompliancePercent,
      projectedCostCents: greedyBreakdown.totalCostCents,
      costBreakdown: greedyBreakdown,
      realizedCostSimulations: greedySims.costs,
      realizedCostStats: greedySims.stats,
    };

    // Track 3: Optimized Plan
    const optBreakdown = FinancialCostModel.calculateForPlan(
      optimizedResult.routes,
      optimizedResult.unassignedStops,
      costParams
    );
    const optSims = this.simulateRealizations(
      optimizedResult,
      seeds,
      trafficVariance,
      dwellVariance,
      costParams
    );
    const optTrack: ScenarioEvaluationTrack = {
      trackName: 'OPTIMIZED_PLAN',
      algorithm: optimizedResult.algorithm,
      vehiclesCount: optBreakdown.vehiclesDeployed,
      distanceKm: optBreakdown.totalDistanceKm,
      shiftHours: optBreakdown.totalShiftHours,
      onTimePercent: optimizedResult.summary.slaCompliancePercent,
      projectedCostCents: optBreakdown.totalCostCents,
      costBreakdown: optBreakdown,
      realizedCostSimulations: optSims.costs,
      realizedCostStats: optSims.stats,
    };

    // Savings calculations: Projected vs Realized
    const projectedCostSavingsVsActualCents =
      histTrack.projectedCostCents - optTrack.projectedCostCents;
    const projectedSavingsPercentVsActual =
      histTrack.projectedCostCents > 0
        ? Math.round((projectedCostSavingsVsActualCents / histTrack.projectedCostCents) * 1000) / 10
        : 0;

    const projectedCostSavingsVsGreedyCents =
      greedyTrack.projectedCostCents - optTrack.projectedCostCents;
    const projectedSavingsPercentVsGreedy =
      greedyTrack.projectedCostCents > 0
        ? Math.round((projectedCostSavingsVsGreedyCents / greedyTrack.projectedCostCents) * 1000) / 10
        : 0;

    // Realized expected savings (Monte Carlo mean delta)
    const realizedExpectedSavingsVsActualCents = Math.round(
      histTrack.projectedCostCents - optSims.stats.mean
    );

    // Confidence interval for savings: [HistCost - UpperBound, HistCost - LowerBound]
    const realizedSavingsConfidenceInterval95: MonteCarloConfidenceInterval = {
      mean: realizedExpectedSavingsVsActualCents,
      stdError: optSims.stats.stdError,
      lower95: Math.round(histTrack.projectedCostCents - optSims.stats.upper95),
      upper95: Math.round(histTrack.projectedCostCents - optSims.stats.lower95),
    };

    const projectedVsRealizedDeltaCents = Math.round(
      optSims.stats.mean - optTrack.projectedCostCents
    );

    let recommendation: string;
    if (realizedSavingsConfidenceInterval95.lower95 > 0) {
      recommendation = `RECOMMENDED FOR PILOT: Projected savings of $${(projectedCostSavingsVsActualCents / 100).toFixed(2)} are statistically robust (95% CI: $${(realizedSavingsConfidenceInterval95.lower95 / 100).toFixed(2)} to $${(realizedSavingsConfidenceInterval95.upper95 / 100).toFixed(2)}).`;
    } else {
      recommendation = `PILOT RISK DETECTED: Realized cost confidence interval includes negative or zero savings ($${(realizedSavingsConfidenceInterval95.lower95 / 100).toFixed(2)}). Further calibration or safety buffer required.`;
    }

    return {
      evaluationId: `eval-${problem.id}-${Date.now()}`,
      evaluationDate: new Date().toISOString(),
      financialAssumptions: costParams,
      historicalActual: histTrack,
      greedyBaseline: greedyTrack,
      optimizedPlan: optTrack,
      comparison: {
        projectedCostSavingsVsActualCents,
        projectedSavingsPercentVsActual,
        projectedCostSavingsVsGreedyCents,
        projectedSavingsPercentVsGreedy,
        realizedExpectedSavingsVsActualCents,
        realizedSavingsConfidenceInterval95,
        riskSummary: {
          slaBreachProbability: optSims.slaBreachProbability,
          projectedVsRealizedDeltaCents,
          recommendation,
        },
      },
    };
  }

  /**
   * Simulates stochastic execution realizations using Common Random Numbers (CRN).
   */
  private static simulateRealizations(
    plan: OptimizationResult,
    seeds: number[],
    trafficVariance: number,
    dwellVariance: number,
    params: CostModelParameters
  ): { costs: number[]; stats: MonteCarloConfidenceInterval; slaBreachProbability: number } {
    const costs: number[] = [];
    let breachRuns = 0;

    for (const seed of seeds) {
      const rng = new SeededRng(seed);
      let runTotalCost = 0;
      let hasLateStopInRun = false;

      const activeRoutes = plan.routes.filter((r) => r.visits.length > 0);
      const vehicleCost = activeRoutes.length * params.fixedCostPerVehicleDayCents;
      runTotalCost += vehicleCost;

      for (const route of activeRoutes) {
        // Apply stochastic perturbations
        const trafficFactor = rng.perturb(trafficVariance);
        const dwellFactor = rng.perturb(dwellVariance);

        const realizedDistanceM = route.totalDistanceM;
        const realizedDrivingS = route.drivingDurationS * trafficFactor;
        const realizedServiceS = route.serviceDurationS * dwellFactor;
        const realizedShiftS = realizedDrivingS + realizedServiceS + route.waitingDurationS;

        const distanceKm = Math.round((realizedDistanceM / 1000) * 100) / 100;
        const regularHours = Math.min(realizedShiftS, params.standardShiftDurationS) / 3600;
        const overtimeHours = Math.max(0, realizedShiftS - params.standardShiftDurationS) / 3600;

        const distanceCost = Math.round(distanceKm * params.fuelAndMaintenancePerKmCents);
        const regularCost = Math.round(regularHours * params.driverHourlyWageCents);
        const overtimeCost = Math.round(overtimeHours * params.overtimeHourlyWageCents);

        // Stochastic arrival delay check
        let simulatedElapsedS = 0;
        let lateCount = 0;
        for (const visit of route.visits) {
          const legDriveS = visit.travelTimeFromPreviousS * trafficFactor;
          const legDwellS = (visit.departureTimeS - visit.serviceStartTimeS) * dwellFactor;
          simulatedElapsedS += legDriveS;

          // Arrival time check
          if (simulatedElapsedS > visit.departureTimeS + 300) {
            // Arrived > 5 min late
            lateCount++;
            hasLateStopInRun = true;
          }
          simulatedElapsedS += legDwellS;
        }

        const latePenalty = lateCount * params.lateArrivalPenaltyPerStopCents;
        runTotalCost += distanceCost + regularCost + overtimeCost + latePenalty;
      }

      // Add unassigned penalties
      runTotalCost += plan.unassignedStops.length * params.unassignedStopPenaltyCents;
      costs.push(Math.round(runTotalCost));

      if (hasLateStopInRun) {
        breachRuns++;
      }
    }

    // Compute stats
    const n = costs.length;
    const sum = costs.reduce((a, b) => a + b, 0);
    const mean = Math.round(sum / n);

    const variance =
      n > 1
        ? costs.reduce((acc, c) => acc + Math.pow(c - mean, 2), 0) / (n - 1)
        : 0;
    const stdDev = Math.sqrt(variance);
    const stdError = Math.round(stdDev / Math.sqrt(n));

    // 95% Confidence Interval z = 1.96
    const lower95 = Math.round(mean - 1.96 * stdError);
    const upper95 = Math.round(mean + 1.96 * stdError);

    const slaBreachProbability = Math.round((breachRuns / n) * 100) / 100;

    return {
      costs,
      stats: { mean, stdError, lower95, upper95 },
      slaBreachProbability,
    };
  }
}
