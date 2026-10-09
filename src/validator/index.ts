/**
 * @fileoverview Independent constraint validator for VRPTW plans.
 *
 * Verifies all hard operational constraints independently of the solver heuristic:
 * - Vehicle capacity limits
 * - Customer time windows (earliest and latest SLA deadlines)
 * - Maximum driver shift durations
 * - Depot operating hours
 * - Unique stop coverage
 */

import { ProblemDefinition, OptimizationResult, ValidationReport, ConstraintViolation } from '../types/index.js';

export class ConstraintValidator {
  /**
   * Validate an optimization plan against the problem definition.
   */
  public static validatePlan(
    problem: ProblemDefinition,
    result: OptimizationResult
  ): ValidationReport {
    const violations: ConstraintViolation[] = [];
    const vehicleMap = new Map(problem.vehicles.map((v) => [v.id, v]));
    const depotMap = new Map(problem.depots.map((d) => [d.id, d]));
    const stopMap = new Map(problem.stops.map((s) => [s.id, s]));

    const visitedStopIds = new Set<string>();

    for (const route of result.routes) {
      const vehicle = vehicleMap.get(route.vehicleId);
      if (!vehicle) {
        violations.push({
          type: 'INVALID_DEPOT',
          vehicleId: route.vehicleId,
          details: `Vehicle ${route.vehicleId} not found in problem definition`,
        });
        continue;
      }

      const startDepot = depotMap.get(route.startDepotId);
      const endDepot = depotMap.get(route.endDepotId);

      if (!startDepot || !endDepot) {
        violations.push({
          type: 'INVALID_DEPOT',
          vehicleId: vehicle.id,
          details: `Start depot ${route.startDepotId} or end depot ${route.endDepotId} not found`,
        });
      }

      let cumulativeLoad = 0;
      let previousDepartureTime = startDepot ? startDepot.openTimeS : 0;
      let routeStartTime = previousDepartureTime;

      if (route.visits.length > 0) {
        // First leg travel from depot to first stop
        routeStartTime = Math.max(
          startDepot ? startDepot.openTimeS : 0,
          route.visits[0].arrivalTimeS - route.visits[0].travelTimeFromPreviousS
        );
      }

      for (const visit of route.visits) {
        const stop = stopMap.get(visit.stopId);
        if (!stop) {
          violations.push({
            type: 'TIME_WINDOW_VIOLATED',
            vehicleId: vehicle.id,
            stopId: visit.stopId,
            details: `Stop ${visit.stopId} not found in problem definition`,
          });
          continue;
        }

        // Check duplicate visit
        if (visitedStopIds.has(visit.stopId)) {
          violations.push({
            type: 'DUPLICATE_VISIT',
            vehicleId: vehicle.id,
            stopId: visit.stopId,
            details: `Stop ${visit.stopId} was visited multiple times across fleet`,
          });
        }
        visitedStopIds.add(visit.stopId);

        // 1. Capacity check
        cumulativeLoad += stop.demandUnits;
        if (cumulativeLoad > vehicle.capacityUnits) {
          violations.push({
            type: 'CAPACITY_EXCEEDED',
            vehicleId: vehicle.id,
            stopId: stop.id,
            details: `Cumulative load ${cumulativeLoad} exceeds vehicle capacity ${vehicle.capacityUnits}`,
          });
        }

        // 2. Time window check (SLA deadline)
        if (visit.arrivalTimeS > stop.latestArrivalS) {
          violations.push({
            type: 'TIME_WINDOW_VIOLATED',
            vehicleId: vehicle.id,
            stopId: stop.id,
            details: `Arrival time ${visit.arrivalTimeS}s exceeds latest allowed SLA deadline ${stop.latestArrivalS}s`,
          });
        }

        // Earliest arrival window
        const effectiveServiceStart = Math.max(visit.arrivalTimeS, stop.earliestArrivalS);
        const expectedDeparture = effectiveServiceStart + stop.serviceDurationS;

        if (Math.abs(visit.departureTimeS - expectedDeparture) > 1) {
          violations.push({
            type: 'TIME_WINDOW_VIOLATED',
            vehicleId: vehicle.id,
            stopId: stop.id,
            details: `Recorded departure ${visit.departureTimeS}s does not match arrival + service duration ${expectedDeparture}s`,
          });
        }

        previousDepartureTime = visit.departureTimeS;
      }

      // 3. Shift duration & return to depot check
      if (route.visits.length > 0 && endDepot) {
        const lastVisit = route.visits[route.visits.length - 1];
        const routeReturnTime = routeStartTime + route.totalDurationS;

        if (route.totalDurationS > vehicle.maxShiftDurationS) {
          violations.push({
            type: 'SHIFT_DURATION_EXCEEDED',
            vehicleId: vehicle.id,
            details: `Route duration ${route.totalDurationS}s exceeds maximum vehicle shift ${vehicle.maxShiftDurationS}s`,
          });
        }

        if (routeReturnTime > endDepot.closeTimeS) {
          violations.push({
            type: 'DEPOT_WINDOW_VIOLATED',
            vehicleId: vehicle.id,
            details: `Return time ${routeReturnTime}s exceeds depot close time ${endDepot.closeTimeS}s`,
          });
        }
      }
    }

    return {
      isValid: violations.length === 0,
      violations,
    };
  }
}
