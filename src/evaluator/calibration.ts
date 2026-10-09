/**
 * @fileoverview Travel-Time and Dwell Calibration Engine with Held-Out Evaluation.
 *
 * Implements statistical calibration of routing durations and stop service dwell times:
 * - Partitions historical observation data into calibration days (train) and held-out days (test).
 * - Calibrates congestion travel factor (ratio between free-flow and observed road travel)
 *   and package handling dwell curves.
 * - Computes Mean Absolute Percentage Error (MAPE), prediction bias, and data-quality coverage.
 * - Guarantees scenarios are evaluated on held-out demand without training on the test set.
 */

import {
  CalibrationDataset,
  CalibrationDataPoint,
  CalibrationMetrics,
  CalibrationResult,
} from '../types/index.js';

export class ModelCalibrator {
  /**
   * Calibrates speed/dwell factors on the training period and independently validates on held-out days.
   */
  public static calibrateAndEvaluate(dataset: CalibrationDataset): CalibrationResult {
    const calDaysSet = new Set(dataset.calibrationDays);
    const heldDaysSet = new Set(dataset.heldOutDays);

    const calibrationRecords = dataset.records.filter((r) => calDaysSet.has(r.date));
    const heldOutRecords = dataset.records.filter((r) => heldDaysSet.has(r.date));

    // Data quality filtering on calibration records
    const validCalRecords = calibrationRecords.filter(
      (r) => !r.hasAnomalies && r.observedDurationS > 0 && r.modeledFreeFlowDurationS > 0
    );

    // Compute empirical travel factor alpha on calibration set
    let sumObservedTravelS = 0;
    let sumModeledTravelS = 0;
    let sumObservedDwellS = 0;
    let sumWeightGrams = 0;

    for (const r of validCalRecords) {
      sumObservedTravelS += r.observedDurationS;
      sumModeledTravelS += r.modeledFreeFlowDurationS;
      sumObservedDwellS += r.observedDwellTimeS;
      sumWeightGrams += r.packageWeightGrams;
    }

    const calibratedTravelFactor =
      sumModeledTravelS > 0 ? Math.round((sumObservedTravelS / sumModeledTravelS) * 1000) / 1000 : 1.0;

    // Calibrated base dwell (dwell for small parcels) + variable dwell per kg
    const totalParcels = validCalRecords.length;
    const avgWeightKg = totalParcels > 0 ? (sumWeightGrams / totalParcels) / 1000 : 2.0;
    const avgObservedDwellS = totalParcels > 0 ? sumObservedDwellS / totalParcels : 180;

    // Linear dwell model: Base + (WeightKg * Factor)
    // Assume base is ~70% of avg dwell, remainder scales with weight
    const calibratedBaseServiceTimeS = Math.round(avgObservedDwellS * 0.7);
    const servicePerKgFactorS =
      avgWeightKg > 0
        ? Math.round(((avgObservedDwellS * 0.3) / avgWeightKg) * 10) / 10
        : 15.0;

    // Compute metrics on calibration set
    const calMetrics = this.computeMetrics(
      calibrationRecords,
      calibratedTravelFactor,
      calibratedBaseServiceTimeS,
      servicePerKgFactorS
    );

    // Compute metrics on held-out set (independent validation)
    const heldMetrics = this.computeMetrics(
      heldOutRecords,
      calibratedTravelFactor,
      calibratedBaseServiceTimeS,
      servicePerKgFactorS
    );

    const notes: string[] = [];
    notes.push(
      `Calibration period: ${dataset.calibrationDays.length} days (${calibrationRecords.length} records), ` +
        `Held-out evaluation period: ${dataset.heldOutDays.length} days (${heldOutRecords.length} records).`
    );
    notes.push(
      `Calibrated Travel Factor alpha = ${calibratedTravelFactor.toFixed(3)} ` +
        `(observed road travel is ${((calibratedTravelFactor - 1.0) * 100).toFixed(1)}% slower than free-flow graph).`
    );
    notes.push(
      `Held-Out Travel Time MAPE: ${heldMetrics.travelTimeMapePercent.toFixed(1)}%, ` +
        `Bias: ${heldMetrics.travelTimeBiasPercent.toFixed(1)}%, ` +
        `Data Coverage: ${heldMetrics.dataQualityCoveragePercent.toFixed(1)}%.`
    );

    // Feasibility gate: MAPE <= 25% on held-out data and coverage >= 90%
    const isCalibrated =
      heldMetrics.sampleSize > 0 &&
      heldMetrics.travelTimeMapePercent <= 25.0 &&
      heldMetrics.dataQualityCoveragePercent >= 90.0;

    if (!isCalibrated) {
      notes.push(
        `WARNING: Held-out performance did not satisfy calibration gate (MAPE <= 25%, Coverage >= 90%). ` +
          `Synthetic or uncalibrated travel feeds cannot be promoted to commercial production.`
      );
    }

    return {
      calibratedTravelFactor,
      calibratedBaseServiceTimeS,
      servicePerKgFactorS,
      calibrationSetMetrics: calMetrics,
      heldOutEvaluationMetrics: heldMetrics,
      isCalibrated,
      notes,
    };
  }

  private static computeMetrics(
    records: CalibrationDataPoint[],
    travelFactor: number,
    baseServiceS: number,
    servicePerKgS: number
  ): CalibrationMetrics {
    if (records.length === 0) {
      return {
        sampleSize: 0,
        travelTimeMapePercent: 0,
        travelTimeBiasPercent: 0,
        dwellTimeMapePercent: 0,
        dataQualityCoveragePercent: 100,
      };
    }

    let validCount = 0;
    let sumAbsPercErrorTravel = 0;
    let sumSignedPercErrorTravel = 0;
    let sumAbsPercErrorDwell = 0;

    for (const r of records) {
      const isRecordValid =
        !r.hasAnomalies &&
        r.observedDurationS > 0 &&
        r.modeledFreeFlowDurationS > 0 &&
        r.observedDwellTimeS > 0;

      if (isRecordValid) {
        validCount++;

        // Predicted travel time with calibrated alpha
        const predictedTravelS = r.modeledFreeFlowDurationS * travelFactor;
        const absErrTravel = Math.abs(r.observedDurationS - predictedTravelS);
        const signedErrTravel = predictedTravelS - r.observedDurationS;
        sumAbsPercErrorTravel += absErrTravel / r.observedDurationS;
        sumSignedPercErrorTravel += signedErrTravel / r.observedDurationS;

        // Predicted dwell time
        const weightKg = r.packageWeightGrams / 1000;
        const predictedDwellS = baseServiceS + weightKg * servicePerKgS;
        const absErrDwell = Math.abs(r.observedDwellTimeS - predictedDwellS);
        sumAbsPercErrorDwell += absErrDwell / r.observedDwellTimeS;
      }
    }

    const dataQualityCoveragePercent =
      Math.round((validCount / records.length) * 1000) / 10;

    if (validCount === 0) {
      return {
        sampleSize: 0,
        travelTimeMapePercent: 0,
        travelTimeBiasPercent: 0,
        dwellTimeMapePercent: 0,
        dataQualityCoveragePercent,
      };
    }

    const travelTimeMapePercent =
      Math.round((sumAbsPercErrorTravel / validCount) * 1000) / 10;
    const travelTimeBiasPercent =
      Math.round((sumSignedPercErrorTravel / validCount) * 1000) / 10;
    const dwellTimeMapePercent =
      Math.round((sumAbsPercErrorDwell / validCount) * 1000) / 10;

    return {
      sampleSize: validCount,
      travelTimeMapePercent,
      travelTimeBiasPercent,
      dwellTimeMapePercent,
      dataQualityCoveragePercent,
    };
  }
}
