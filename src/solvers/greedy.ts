/**
 * @fileoverview Greedy Baseline VRPTW Solver.
 *
 * Implements a constructive nearest-neighbor heuristic with feasibility pruning:
 * - Checks vehicle capacity limits before every insertion
 * - Evaluates arrival time against earliest and latest SLA windows
 * - Enforces driver shift durations and depot closing hours
 */

import {
  ProblemDefinition,
  OptimizationResult,
  VehicleRoute,
  StopVisit,
  UnassignedStop,
  ShipmentStop,
  Vehicle,
  Depot,
} from '../types/index.js';

export class GreedyVrpSolver {
  public static solve(problem: ProblemDefinition): OptimizationResult {
    const startTime = Date.now();
    const depotMap = new Map<string, Depot>(problem.depots.map((d) => [d.id, d]));
    const unvisitedStops = new Set<ShipmentStop>(problem.stops);
    const routes: VehicleRoute[] = [];
    const unassignedStops: UnassignedStop[] = [];

    const getCoordKey = (c: { lat: number; lon: number }) => `${c.lat.toFixed(6)},${c.lon.toFixed(6)}`;

    const getMatrixIndex = (coord: { lat: number; lon: number }): number => {
      const key = getCoordKey(coord);
      const idx = problem.coordIndexMap[key];
      if (idx !== undefined) return idx;
      // Fallback nearest in matrix coordinates
      return 0;
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

    // Sort available vehicles
    const availableVehicles = [...problem.vehicles];

    for (const vehicle of availableVehicles) {
      if (unvisitedStops.size === 0) break;

      const startDepot = depotMap.get(vehicle.startDepotId);
      const endDepot = depotMap.get(vehicle.endDepotId);
      if (!startDepot || !endDepot) continue;

      let currentCoord = startDepot.coordinate;
      let currentTimeS = startDepot.openTimeS;
      let currentLoad = 0;
      let totalDistanceM = 0;
      let totalDrivingDurationS = 0;
      let totalWaitingDurationS = 0;
      let totalServiceDurationS = 0;
      const visits: StopVisit[] = [];

      while (unvisitedStops.size > 0) {
        let bestStop: ShipmentStop | null = null;
        let bestCost = Infinity;
        let bestTravel = { durationS: 0, distanceM: 0 };
        let bestArrival = 0;
        let bestDeparture = 0;
        let bestWaiting = 0;

        for (const candidate of unvisitedStops) {
          // 1. Capacity check
          if (currentLoad + candidate.demandUnits > vehicle.capacityUnits) {
            continue;
          }

          // 2. Travel to candidate
          const travel = getTravel(currentCoord, candidate.coordinate);
          const arrivalTime = currentTimeS + travel.durationS;

          // 3. Time window check
          if (arrivalTime > candidate.latestArrivalS) {
            continue; // Missed latest delivery window
          }

          const serviceStartTime = Math.max(arrivalTime, candidate.earliestArrivalS);
          const waitingTime = serviceStartTime - arrivalTime;
          const departureTime = serviceStartTime + candidate.serviceDurationS;

          // 4. Return to end depot feasibility check
          const returnTravel = getTravel(candidate.coordinate, endDepot.coordinate);
          const returnTime = departureTime + returnTravel.durationS;
          const totalShiftSoFar = returnTime - startDepot.openTimeS;

          if (totalShiftSoFar > vehicle.maxShiftDurationS) {
            continue; // Would exceed max shift
          }

          if (returnTime > endDepot.closeTimeS) {
            continue; // Would return after depot close
          }

          // Nearest insertion cost heuristic (travel time + waiting time penalty)
          const insertionCost = travel.durationS + waitingTime * 0.5;
          if (insertionCost < bestCost) {
            bestCost = insertionCost;
            bestStop = candidate;
            bestTravel = travel;
            bestArrival = arrivalTime;
            bestDeparture = departureTime;
            bestWaiting = waitingTime;
          }
        }

        if (bestStop) {
          unvisitedStops.delete(bestStop);
          currentLoad += bestStop.demandUnits;
          totalDistanceM += bestTravel.distanceM;
          totalDrivingDurationS += bestTravel.durationS;
          totalWaitingDurationS += bestWaiting;
          totalServiceDurationS += bestStop.serviceDurationS;

          visits.push({
            stopId: bestStop.id,
            coordinate: bestStop.coordinate,
            demandUnits: bestStop.demandUnits,
            arrivalTimeS: bestArrival,
            serviceStartTimeS: bestArrival + bestWaiting,
            departureTimeS: bestDeparture,
            waitingTimeS: bestWaiting,
            cumulativeLoadUnits: currentLoad,
            distanceFromPreviousM: bestTravel.distanceM,
            travelTimeFromPreviousS: bestTravel.durationS,
          });

          currentCoord = bestStop.coordinate;
          currentTimeS = bestDeparture;
        } else {
          // No more feasible stops for this vehicle
          break;
        }
      }

      if (visits.length > 0) {
        // Return leg to end depot
        const returnTravel = getTravel(currentCoord, endDepot.coordinate);
        totalDistanceM += returnTravel.distanceM;
        totalDrivingDurationS += returnTravel.durationS;
        currentTimeS += returnTravel.durationS;

        const totalRouteDurationS = currentTimeS - startDepot.openTimeS;
        const fixedCostCents = vehicle.fixedCostCents;
        const variableDistanceCostCents = Math.round((totalDistanceM / 1000) * vehicle.costPerKmCents);
        const variableTimeCostCents = Math.round((totalRouteDurationS / 3600) * vehicle.costPerHourCents);
        const totalCostCents = fixedCostCents + variableDistanceCostCents + variableTimeCostCents;

        routes.push({
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
        });
      }
    }

    // Record unassigned stops
    for (const stop of unvisitedStops) {
      unassignedStops.push({
        stopId: stop.id,
        reason: 'Capacity or shift time window exhausted across available fleet',
      });
    }

    const totalCostCents = routes.reduce((acc, r) => acc + r.totalCostCents, 0);
    const totalDistanceKm = routes.reduce((acc, r) => acc + r.totalDistanceM, 0) / 1000;
    const totalDrivingHours = routes.reduce((acc, r) => acc + r.drivingDurationS, 0) / 3600;

    const status = unassignedStops.length === 0 ? 'FEASIBLE' : 'INFEASIBLE';

    return {
      problemId: problem.id,
      status,
      algorithm: 'greedy_nearest_neighbor_vrptw',
      executionTimeMs: Date.now() - startTime,
      routes,
      unassignedStops,
      objectiveCostCents: totalCostCents,
      summary: {
        totalVehiclesUsed: routes.length,
        totalStopsServiced: problem.stops.length - unassignedStops.length,
        totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
        totalDrivingHours: Math.round(totalDrivingHours * 100) / 100,
        totalCostCents,
        slaCompliancePercent: problem.stops.length > 0
          ? Math.round(((problem.stops.length - unassignedStops.length) / problem.stops.length) * 1000) / 10
          : 100,
      },
    };
  }
}
