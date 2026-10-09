/**
 * @fileoverview Explicit Financial Cost-to-Serve Model.
 *
 * Implements transparent, parameterized cost accounting across:
 * - Fixed vehicle capital/lease costs ($/vehicle/day)
 * - Variable distance costs ($/km)
 * - Regular driver labor hours ($/hour)
 * - Overtime labor hours ($/hour)
 * - SLA delivery delay penalties ($/late stop)
 * - Dropped order opportunity / breach penalties ($/dropped stop)
 */

import {
  CostModelParameters,
  CostToServeBreakdown,
  VehicleRoute,
  UnassignedStop,
  HistoricalTrip,
} from '../types/index.js';

export const DEFAULT_COST_PARAMETERS: CostModelParameters = {
  fixedCostPerVehicleDayCents: 4500, // $45.00 fixed vehicle overhead per day
  fuelAndMaintenancePerKmCents: 35,  // $0.35 per kilometer (fuel + tires + wear)
  driverHourlyWageCents: 1250,       // $12.50 / hour regular driver pay
  overtimeHourlyWageCents: 1875,     // $18.75 / hour overtime (1.5x)
  standardShiftDurationS: 28800,     // 8.0 hours standard shift
  lateArrivalPenaltyPerStopCents: 1500, // $15.00 SLA late penalty
  unassignedStopPenaltyCents: 5000,    // $50.00 missed stop penalty
};

export class FinancialCostModel {
  /**
   * Calculates a complete cost-to-serve breakdown for an optimized/planned fleet solution.
   */
  public static calculateForPlan(
    routes: VehicleRoute[],
    unassignedStops: UnassignedStop[] = [],
    customParams: Partial<CostModelParameters> = {}
  ): CostToServeBreakdown {
    const params: CostModelParameters = { ...DEFAULT_COST_PARAMETERS, ...customParams };

    const activeRoutes = routes.filter((r) => r.visits.length > 0);
    const vehiclesDeployed = activeRoutes.length;

    let totalDistanceM = 0;
    let totalShiftDurationS = 0;
    let totalRegularDurationS = 0;
    let totalOvertimeDurationS = 0;
    let lateStopsCount = 0;

    for (const route of activeRoutes) {
      totalDistanceM += route.totalDistanceM;
      totalShiftDurationS += route.totalDurationS;

      if (route.totalDurationS <= params.standardShiftDurationS) {
        totalRegularDurationS += route.totalDurationS;
      } else {
        totalRegularDurationS += params.standardShiftDurationS;
        totalOvertimeDurationS += route.totalDurationS - params.standardShiftDurationS;
      }

      // Check SLA late arrivals in visits
      for (const visit of route.visits) {
        // Late if arrival was after latest allowable window
        // (visit has travel time and waiting time recorded)
        if (visit.waitingTimeS < 0) {
          lateStopsCount++;
        }
      }
    }

    const totalDistanceKm = Math.round((totalDistanceM / 1000) * 100) / 100;
    const totalShiftHours = Math.round((totalShiftDurationS / 3600) * 100) / 100;
    const regularHours = Math.round((totalRegularDurationS / 3600) * 100) / 100;
    const overtimeHours = Math.round((totalOvertimeDurationS / 3600) * 100) / 100;
    const unassignedStopsCount = unassignedStops.length;

    // Explicit cost elements in integer cents
    const fixedVehicleCostCents = vehiclesDeployed * params.fixedCostPerVehicleDayCents;
    const distanceCostCents = Math.round(totalDistanceKm * params.fuelAndMaintenancePerKmCents);
    const regularLaborCostCents = Math.round(regularHours * params.driverHourlyWageCents);
    const overtimeLaborCostCents = Math.round(overtimeHours * params.overtimeHourlyWageCents);
    const latePenaltyCostCents = lateStopsCount * params.lateArrivalPenaltyPerStopCents;
    const unassignedPenaltyCostCents = unassignedStopsCount * params.unassignedStopPenaltyCents;

    const totalCostCents =
      fixedVehicleCostCents +
      distanceCostCents +
      regularLaborCostCents +
      overtimeLaborCostCents +
      latePenaltyCostCents +
      unassignedPenaltyCostCents;

    const totalServicedStops = activeRoutes.reduce((acc, r) => acc + r.visits.length, 0);
    const averageCostPerStopCents =
      totalServicedStops > 0 ? Math.round(totalCostCents / totalServicedStops) : totalCostCents;
    const averageCostPerKmCents =
      totalDistanceKm > 0 ? Math.round(totalCostCents / totalDistanceKm) : 0;

    return {
      vehiclesDeployed,
      totalDistanceKm,
      totalShiftHours,
      regularHours,
      overtimeHours,
      lateStopsCount,
      unassignedStopsCount,
      fixedVehicleCostCents,
      distanceCostCents,
      regularLaborCostCents,
      overtimeLaborCostCents,
      latePenaltyCostCents,
      unassignedPenaltyCostCents,
      totalCostCents,
      averageCostPerStopCents,
      averageCostPerKmCents,
    };
  }

  /**
   * Calculates a complete cost-to-serve breakdown for historical executed trips.
   */
  public static calculateForTrips(
    trips: HistoricalTrip[],
    customParams: Partial<CostModelParameters> = {}
  ): CostToServeBreakdown {
    const params: CostModelParameters = { ...DEFAULT_COST_PARAMETERS, ...customParams };

    const uniqueVehicles = new Set(trips.map((t) => t.vehicleId)).size;
    let totalDistanceKm = 0;
    let totalShiftDurationS = 0;
    let totalRegularDurationS = 0;
    let totalOvertimeDurationS = 0;
    let lateStopsCount = 0;
    let totalStopsCount = 0;

    for (const trip of trips) {
      totalDistanceKm += trip.recordedOdometerKm;
      totalShiftDurationS += trip.recordedDurationS;

      if (trip.recordedDurationS <= params.standardShiftDurationS) {
        totalRegularDurationS += trip.recordedDurationS;
      } else {
        totalRegularDurationS += params.standardShiftDurationS;
        totalOvertimeDurationS += trip.recordedDurationS - params.standardShiftDurationS;
      }

      for (const stop of trip.stops) {
        totalStopsCount++;
        if (stop.isLate || stop.actualArrivalS > stop.slaDeadlineS) {
          lateStopsCount++;
        }
      }
    }

    totalDistanceKm = Math.round(totalDistanceKm * 100) / 100;
    const totalShiftHours = Math.round((totalShiftDurationS / 3600) * 100) / 100;
    const regularHours = Math.round((totalRegularDurationS / 3600) * 100) / 100;
    const overtimeHours = Math.round((totalOvertimeDurationS / 3600) * 100) / 100;

    const fixedVehicleCostCents = uniqueVehicles * params.fixedCostPerVehicleDayCents;
    const distanceCostCents = Math.round(totalDistanceKm * params.fuelAndMaintenancePerKmCents);
    const regularLaborCostCents = Math.round(regularHours * params.driverHourlyWageCents);
    const overtimeLaborCostCents = Math.round(overtimeHours * params.overtimeHourlyWageCents);
    const latePenaltyCostCents = lateStopsCount * params.lateArrivalPenaltyPerStopCents;
    const unassignedStopsCount = 0;
    const unassignedPenaltyCostCents = 0; // Historical records only record executed trips

    const totalCostCents =
      fixedVehicleCostCents +
      distanceCostCents +
      regularLaborCostCents +
      overtimeLaborCostCents +
      latePenaltyCostCents +
      unassignedPenaltyCostCents;

    const averageCostPerStopCents =
      totalStopsCount > 0 ? Math.round(totalCostCents / totalStopsCount) : 0;
    const averageCostPerKmCents =
      totalDistanceKm > 0 ? Math.round(totalCostCents / totalDistanceKm) : 0;

    return {
      vehiclesDeployed: uniqueVehicles,
      totalDistanceKm,
      totalShiftHours,
      regularHours,
      overtimeHours,
      lateStopsCount,
      unassignedStopsCount,
      fixedVehicleCostCents,
      distanceCostCents,
      regularLaborCostCents,
      overtimeLaborCostCents,
      latePenaltyCostCents,
      unassignedPenaltyCostCents,
      totalCostCents,
      averageCostPerStopCents,
      averageCostPerKmCents,
    };
  }

  /**
   * Formats breakdown into human-readable financial summary string.
   */
  public static formatBreakdown(breakdown: CostToServeBreakdown): string {
    return [
      `Vehicles Deployed  : ${breakdown.vehiclesDeployed} ($${(breakdown.fixedVehicleCostCents / 100).toFixed(2)})`,
      `Distance Traveled  : ${breakdown.totalDistanceKm} km ($${(breakdown.distanceCostCents / 100).toFixed(2)})`,
      `Regular Labor      : ${breakdown.regularHours} hrs ($${(breakdown.regularLaborCostCents / 100).toFixed(2)})`,
      `Overtime Labor     : ${breakdown.overtimeHours} hrs ($${(breakdown.overtimeLaborCostCents / 100).toFixed(2)})`,
      `SLA Late Penalties : ${breakdown.lateStopsCount} stops ($${(breakdown.latePenaltyCostCents / 100).toFixed(2)})`,
      `Unassigned Drops   : ${breakdown.unassignedStopsCount} stops ($${(breakdown.unassignedPenaltyCostCents / 100).toFixed(2)})`,
      `TOTAL COST-TO-SERVE: $${(breakdown.totalCostCents / 100).toFixed(2)} ($${(breakdown.averageCostPerStopCents / 100).toFixed(2)}/stop, $${(breakdown.averageCostPerKmCents / 100).toFixed(2)}/km)`,
    ].join('\n');
  }
}
