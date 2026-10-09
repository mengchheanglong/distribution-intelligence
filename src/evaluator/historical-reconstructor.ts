/**
 * @fileoverview Historical Operational Baseline Reconstructor.
 *
 * Ingests historical trip logs and shipment deliveries to reconstruct:
 * - Actual deployed fleet size
 * - Actual odometer kilometers and driving/dwell hours
 * - Observed SLA on-time arrival rate
 * - Ground truth financial cost-to-serve
 */

import {
  HistoricalTrip,
  HistoricalBaselineReport,
  CostModelParameters,
} from '../types/index.js';
import { FinancialCostModel } from '../financial/cost-model.js';

export class HistoricalReconstructor {
  /**
   * Reconstructs an operational baseline from raw recorded trip executions.
   */
  public static reconstructBaseline(
    trips: HistoricalTrip[],
    datasetName: string = 'Historical-Fleet-Logs',
    costParams: Partial<CostModelParameters> = {}
  ): HistoricalBaselineReport {
    if (trips.length === 0) {
      const emptyBreakdown = FinancialCostModel.calculateForTrips([], costParams);
      return {
        datasetName,
        totalDays: 0,
        totalTrips: 0,
        totalStops: 0,
        totalVehiclesUsed: 0,
        totalDistanceKm: 0,
        totalShiftHours: 0,
        onTimeStopsCount: 0,
        lateStopsCount: 0,
        onTimePercent: 100,
        financialBreakdown: emptyBreakdown,
      };
    }

    const uniqueDays = new Set(trips.map((t) => t.date)).size;
    const uniqueVehicles = new Set(trips.map((t) => t.vehicleId)).size;

    let totalStops = 0;
    let onTimeStopsCount = 0;
    let lateStopsCount = 0;
    let totalDistanceKm = 0;
    let totalDurationS = 0;

    for (const trip of trips) {
      totalDistanceKm += trip.recordedOdometerKm;
      totalDurationS += trip.recordedDurationS;

      for (const stop of trip.stops) {
        totalStops++;
        const isLate = stop.isLate || stop.actualArrivalS > stop.slaDeadlineS;
        if (isLate) {
          lateStopsCount++;
        } else {
          onTimeStopsCount++;
        }
      }
    }

    totalDistanceKm = Math.round(totalDistanceKm * 100) / 100;
    const totalShiftHours = Math.round((totalDurationS / 3600) * 100) / 100;
    const onTimePercent =
      totalStops > 0 ? Math.round((onTimeStopsCount / totalStops) * 1000) / 10 : 100;

    const financialBreakdown = FinancialCostModel.calculateForTrips(trips, costParams);

    return {
      datasetName,
      totalDays: uniqueDays,
      totalTrips: trips.length,
      totalStops,
      totalVehiclesUsed: uniqueVehicles,
      totalDistanceKm,
      totalShiftHours,
      onTimeStopsCount,
      lateStopsCount,
      onTimePercent,
      financialBreakdown,
    };
  }
}
