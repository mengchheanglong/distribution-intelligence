/**
 * @fileoverview Metaheuristic Local Search VRPTW Optimizer.
 *
 * Employs iterative local search neighborhood operators:
 * - 2-Opt intra-route edge untangling
 * - Inter-route stop relocation (Shift operator)
 * - Fleet vehicle consolidation
 * With strict constraint feasibility verification at every step.
 */

import {
  ProblemDefinition,
  OptimizationResult,
  VehicleRoute,
  StopVisit,
  ShipmentStop,
  Depot,
  Vehicle,
} from '../types/index.js';
import { GreedyVrpSolver } from './greedy.js';
import { ConstraintValidator } from '../validator/index.js';

export class MetaheuristicVrpOptimizer {
  public static solve(
    problem: ProblemDefinition,
    options: { maxIterations?: number; timeLimitMs?: number } = {}
  ): OptimizationResult {
    const startTime = Date.now();
    const maxIterations = options.maxIterations ?? 50;
    const timeLimitMs = options.timeLimitMs ?? 3000;

    // 1. Initial constructive baseline solution
    const baseline = GreedyVrpSolver.solve(problem);
    if (baseline.routes.length === 0) {
      return baseline;
    }

    const depotMap = new Map<string, Depot>(problem.depots.map((d) => [d.id, d]));
    const vehicleMap = new Map<string, Vehicle>(problem.vehicles.map((v) => [v.id, v]));
    const stopMap = new Map<string, ShipmentStop>(problem.stops.map((s) => [s.id, s]));

    const getCoordKey = (c: { lat: number; lon: number }) => `${c.lat.toFixed(6)},${c.lon.toFixed(6)}`;

    const getMatrixIndex = (coord: { lat: number; lon: number }): number => {
      const key = getCoordKey(coord);
      const idx = problem.coordIndexMap[key];
      return idx !== undefined ? idx : 0;
    };

    const getTravel = (fromCoord: { lat: number; lon: number }, toCoord: { lat: number; lon: number }) => {
      const i = getMatrixIndex(fromCoord);
      const j = getMatrixIndex(toCoord);
      const durationS = problem.matrix.durationsS[i]?.[j] ?? 300;
      const distanceM = problem.matrix.distancesM[i]?.[j] ?? 2500;
      return {
        durationS: durationS ?? 300,
        distanceM: distanceM ?? 2500,
      };
    };

    // Reconstruct route metrics from stop sequence
    const buildRoute = (vehicleId: string, stopIds: string[]): VehicleRoute | null => {
      const vehicle = vehicleMap.get(vehicleId);
      if (!vehicle) return null;
      const startDepot = depotMap.get(vehicle.startDepotId);
      const endDepot = depotMap.get(vehicle.endDepotId);
      if (!startDepot || !endDepot) return null;

      let currentCoord = startDepot.coordinate;
      let currentTimeS = startDepot.openTimeS;
      let currentLoad = 0;
      let totalDistanceM = 0;
      let totalDrivingDurationS = 0;
      let totalWaitingDurationS = 0;
      let totalServiceDurationS = 0;
      const visits: StopVisit[] = [];

      for (const stopId of stopIds) {
        const stop = stopMap.get(stopId);
        if (!stop) return null;

        // Capacity
        currentLoad += stop.demandUnits;
        if (currentLoad > vehicle.capacityUnits) return null;

        const travel = getTravel(currentCoord, stop.coordinate);
        const arrivalTime = currentTimeS + travel.durationS;

        // Time window (SLA deadline)
        if (arrivalTime > stop.latestArrivalS) return null;

        const serviceStartTimeS = Math.max(arrivalTime, stop.earliestArrivalS);
        const waitingTime = serviceStartTimeS - arrivalTime;
        const departureTime = serviceStartTimeS + stop.serviceDurationS;

        totalDistanceM += travel.distanceM;
        totalDrivingDurationS += travel.durationS;
        totalWaitingDurationS += waitingTime;
        totalServiceDurationS += stop.serviceDurationS;

        visits.push({
          stopId: stop.id,
          coordinate: stop.coordinate,
          demandUnits: stop.demandUnits,
          arrivalTimeS: arrivalTime,
          serviceStartTimeS,
          departureTimeS: departureTime,
          waitingTimeS: waitingTime,
          cumulativeLoadUnits: currentLoad,
          distanceFromPreviousM: travel.distanceM,
          travelTimeFromPreviousS: travel.durationS,
        });

        currentCoord = stop.coordinate;
        currentTimeS = departureTime;
      }

      // Return to end depot
      const returnTravel = getTravel(currentCoord, endDepot.coordinate);
      totalDistanceM += returnTravel.distanceM;
      totalDrivingDurationS += returnTravel.durationS;
      currentTimeS += returnTravel.durationS;

      const totalRouteDurationS = currentTimeS - startDepot.openTimeS;
      if (totalRouteDurationS > vehicle.maxShiftDurationS) return null;
      if (currentTimeS > endDepot.closeTimeS) return null;

      const fixedCostCents = vehicle.fixedCostCents;
      const variableDistanceCostCents = Math.round((totalDistanceM / 1000) * vehicle.costPerKmCents);
      const variableTimeCostCents = Math.round((totalRouteDurationS / 3600) * vehicle.costPerHourCents);
      const totalCostCents = fixedCostCents + variableDistanceCostCents + variableTimeCostCents;

      return {
        vehicleId: vehicle.id,
        startDepotId: vehicle.startDepotId,
        endDepotId: vehicle.endDepotId,
        visits,
        totalDistanceM,
        totalDurationS: totalRouteDurationS,
        drivingDurationS: totalDrivingDurationS,
        waitingDurationS: totalWaitingDurationS,
        serviceDurationS: totalServiceDurationS,
        peakLoadUnits: currentLoad,
        fixedCostCents,
        variableDistanceCostCents,
        variableTimeCostCents,
        totalCostCents,
      };
    };

    // Deep copy routes from baseline
    let currentRoutes: { vehicleId: string; stopIds: string[] }[] = baseline.routes.map((r) => ({
      vehicleId: r.vehicleId,
      stopIds: r.visits.map((v) => v.stopId),
    }));

    let bestTotalCost = baseline.objectiveCostCents;
    let iteration = 0;

    while (iteration < maxIterations && Date.now() - startTime < timeLimitMs) {
      iteration++;
      let improved = false;

      // 1. Intra-route 2-Opt optimization
      for (let rIdx = 0; rIdx < currentRoutes.length; rIdx++) {
        const routeData = currentRoutes[rIdx];
        const stops = [...routeData.stopIds];
        if (stops.length < 3) continue;

        for (let i = 0; i < stops.length - 1; i++) {
          for (let j = i + 1; j < stops.length; j++) {
            // Reverse subsequence [i..j]
            const candidateStops = [
              ...stops.slice(0, i),
              ...stops.slice(i, j + 1).reverse(),
              ...stops.slice(j + 1),
            ];

            const candidateRoute = buildRoute(routeData.vehicleId, candidateStops);
            if (candidateRoute) {
              const currentRoute = buildRoute(routeData.vehicleId, stops)!;
              if (candidateRoute.totalCostCents < currentRoute.totalCostCents) {
                routeData.stopIds = candidateStops;
                improved = true;
                break;
              }
            }
          }
          if (improved) break;
        }
      }

      // 2. Inter-route Relocate (move stop from route A to route B)
      for (let fromIdx = 0; fromIdx < currentRoutes.length; fromIdx++) {
        for (let toIdx = 0; toIdx < currentRoutes.length; toIdx++) {
          if (fromIdx === toIdx) continue;

          const fromRoute = currentRoutes[fromIdx];
          const toRoute = currentRoutes[toIdx];

          for (let sIdx = 0; sIdx < fromRoute.stopIds.length; sIdx++) {
            const stopToMove = fromRoute.stopIds[sIdx];
            const candidateFromStops = fromRoute.stopIds.filter((_, idx) => idx !== sIdx);

            // Try all insertion positions in toRoute
            for (let insertPos = 0; insertPos <= toRoute.stopIds.length; insertPos++) {
              const candidateToStops = [
                ...toRoute.stopIds.slice(0, insertPos),
                stopToMove,
                ...toRoute.stopIds.slice(insertPos),
              ];

              const newToRoute = buildRoute(toRoute.vehicleId, candidateToStops);
              if (!newToRoute) continue;

              const newFromRoute =
                candidateFromStops.length > 0
                  ? buildRoute(fromRoute.vehicleId, candidateFromStops)
                  : null;

              if (candidateFromStops.length > 0 && !newFromRoute) continue;

              const oldFromCost = buildRoute(fromRoute.vehicleId, fromRoute.stopIds)!.totalCostCents;
              const oldToCost = buildRoute(toRoute.vehicleId, toRoute.stopIds)!.totalCostCents;
              const newFromCost = newFromRoute ? newFromRoute.totalCostCents : 0;
              const newToCost = newToRoute.totalCostCents;

              if (newFromCost + newToCost < oldFromCost + oldToCost) {
                fromRoute.stopIds = candidateFromStops;
                toRoute.stopIds = candidateToStops;
                improved = true;
                break;
              }
            }
            if (improved) break;
          }
          if (improved) break;
        }
        if (improved) break;
      }

      // Filter out completely emptied routes (consolidated vehicles)
      currentRoutes = currentRoutes.filter((r) => r.stopIds.length > 0);

      // Recalculate total cost
      const newTotalCost = currentRoutes.reduce((acc, r) => {
        const built = buildRoute(r.vehicleId, r.stopIds);
        return acc + (built ? built.totalCostCents : Infinity);
      }, 0);

      if (newTotalCost < bestTotalCost) {
        bestTotalCost = newTotalCost;
      }

      if (!improved) break; // Reached local optimum
    }

    // Build finalized optimized routes
    const finalRoutes: VehicleRoute[] = [];
    for (const r of currentRoutes) {
      const built = buildRoute(r.vehicleId, r.stopIds);
      if (built) finalRoutes.push(built);
    }

    const totalDistanceKm = finalRoutes.reduce((acc, r) => acc + r.totalDistanceM, 0) / 1000;
    const totalDrivingHours = finalRoutes.reduce((acc, r) => acc + r.drivingDurationS, 0) / 3600;

    const result: OptimizationResult = {
      problemId: problem.id,
      status: baseline.unassignedStops.length === 0 ? 'OPTIMAL' : 'FEASIBLE',
      algorithm: 'metaheuristic_localsearch_vrptw',
      executionTimeMs: Date.now() - startTime,
      routes: finalRoutes,
      unassignedStops: baseline.unassignedStops,
      objectiveCostCents: bestTotalCost,
      summary: {
        totalVehiclesUsed: finalRoutes.length,
        totalStopsServiced: problem.stops.length - baseline.unassignedStops.length,
        totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
        totalDrivingHours: Math.round(totalDrivingHours * 100) / 100,
        totalCostCents: bestTotalCost,
        slaCompliancePercent: baseline.summary.slaCompliancePercent,
      },
    };

    return result;
  }
}
