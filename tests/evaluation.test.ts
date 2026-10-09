import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FinancialCostModel,
  DEFAULT_COST_PARAMETERS,
  HistoricalReconstructor,
  ModelCalibrator,
  ScenarioComparator,
  SnapshotProblemAdapter,
  GreedyVrpSolver,
  MetaheuristicVrpOptimizer,
  HistoricalTrip,
  CalibrationDataset,
} from '../src/index.js';

describe('EVAL-01: Financial Cost Model, Historical Reconstruction, Calibration & Comparison', () => {
  // --------------------------------------------------------------------------
  // 1. Explicit Financial Cost-to-Serve Model
  // --------------------------------------------------------------------------
  describe('1. Financial Cost-to-Serve Accounting', () => {
    it('computes transparent cost breakdown with regular and overtime labor', () => {
      // 2 vehicles, each driving 10 hours (8h regular + 2h overtime)
      const mockRoutes = [
        {
          vehicleId: 'veh-01',
          startDepotId: 'depot-1',
          endDepotId: 'depot-1',
          visits: [
            {
              stopId: 'stop-1',
              coordinate: { lat: 11.55, lon: 104.92 },
              demandUnits: 5,
              arrivalTimeS: 3600,
              serviceStartTimeS: 3600,
              departureTimeS: 4200,
              waitingTimeS: 0,
              cumulativeLoadUnits: 5,
              distanceFromPreviousM: 15000,
              travelTimeFromPreviousS: 1800,
            },
          ],
          totalDistanceM: 50000, // 50 km
          totalDurationS: 36000, // 10.0 hours (8h reg + 2h OT)
          drivingDurationS: 25000,
          waitingDurationS: 0,
          serviceDurationS: 11000,
          peakLoadUnits: 5,
          fixedCostCents: 0,
          variableDistanceCostCents: 0,
          variableTimeCostCents: 0,
          totalCostCents: 0,
        },
      ];

      const breakdown = FinancialCostModel.calculateForPlan(mockRoutes, [], {
        fixedCostPerVehicleDayCents: 4500, // $45.00
        fuelAndMaintenancePerKmCents: 35,  // $0.35/km
        driverHourlyWageCents: 1250,       // $12.50/hr
        overtimeHourlyWageCents: 1875,     // $18.75/hr
        standardShiftDurationS: 28800,     // 8.0h threshold
      });

      assert.equal(breakdown.vehiclesDeployed, 1);
      assert.equal(breakdown.totalDistanceKm, 50);
      assert.equal(breakdown.totalShiftHours, 10.0);
      assert.equal(breakdown.regularHours, 8.0);
      assert.equal(breakdown.overtimeHours, 2.0);

      // Expected costs:
      // Fixed: 1 * 4500 = 4500 ($45.00)
      // Distance: 50 * 35 = 1750 ($17.50)
      // Regular Labor: 8 * 1250 = 10000 ($100.00)
      // Overtime Labor: 2 * 1875 = 3750 ($37.50)
      // Total: 4500 + 1750 + 10000 + 3750 = 20000 ($200.00)
      assert.equal(breakdown.fixedVehicleCostCents, 4500);
      assert.equal(breakdown.distanceCostCents, 1750);
      assert.equal(breakdown.regularLaborCostCents, 10000);
      assert.equal(breakdown.overtimeLaborCostCents, 3750);
      assert.equal(breakdown.totalCostCents, 20000);

      const formatted = FinancialCostModel.formatBreakdown(breakdown);
      assert.ok(formatted.includes('TOTAL COST-TO-SERVE: $200.00'));
    });

    it('accounts for unassigned drop penalties and SLA late arrival penalties', () => {
      const mockRoutes = [
        {
          vehicleId: 'veh-01',
          startDepotId: 'depot-1',
          endDepotId: 'depot-1',
          visits: [
            {
              stopId: 'stop-late',
              coordinate: { lat: 11.55, lon: 104.92 },
              demandUnits: 2,
              arrivalTimeS: 7200,
              serviceStartTimeS: 7200,
              departureTimeS: 7500,
              waitingTimeS: -600, // 10 min late
              cumulativeLoadUnits: 2,
              distanceFromPreviousM: 10000,
              travelTimeFromPreviousS: 1200,
            },
          ],
          totalDistanceM: 20000,
          totalDurationS: 7200,
          drivingDurationS: 6000,
          waitingDurationS: 0,
          serviceDurationS: 1200,
          peakLoadUnits: 2,
          fixedCostCents: 0,
          variableDistanceCostCents: 0,
          variableTimeCostCents: 0,
          totalCostCents: 0,
        },
      ];

      const unassigned = [{ stopId: 'stop-dropped-1', reason: 'Capacity limit' }];

      const breakdown = FinancialCostModel.calculateForPlan(mockRoutes, unassigned, {
        lateArrivalPenaltyPerStopCents: 1500, // $15.00
        unassignedStopPenaltyCents: 5000,    // $50.00
      });

      assert.equal(breakdown.lateStopsCount, 1);
      assert.equal(breakdown.unassignedStopsCount, 1);
      assert.equal(breakdown.latePenaltyCostCents, 1500);
      assert.equal(breakdown.unassignedPenaltyCostCents, 5000);
      assert.ok(breakdown.totalCostCents > 6500);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Historical Baseline Reconstruction
  // --------------------------------------------------------------------------
  describe('2. Historical Operational Baseline Reconstruction', () => {
    const historicalTrips: HistoricalTrip[] = [
      {
        tripId: 'trip-20261001-v1',
        vehicleId: 'veh-01',
        driverId: 'drv-101',
        date: '2026-10-01',
        depotId: 'depot-central',
        startDepotDepartureS: 28800, // 08:00
        endDepotArrivalS: 54000,     // 15:00 (7 hours)
        recordedOdometerKm: 65.5,
        recordedDurationS: 25200,    // 7.0 hours
        stops: [
          {
            stopId: 'stop-h1',
            orderId: 'so-1',
            coordinate: { lat: 11.56, lon: 104.91 },
            actualArrivalS: 32400,
            actualDepartureS: 32700,
            slaDeadlineS: 36000, // On-time
            dwellTimeS: 300,
            weightGrams: 2500,
            isLate: false,
          },
          {
            stopId: 'stop-h2',
            orderId: 'so-2',
            coordinate: { lat: 11.57, lon: 104.93 },
            actualArrivalS: 40000,
            actualDepartureS: 40300,
            slaDeadlineS: 39600, // 400s late
            dwellTimeS: 300,
            weightGrams: 3000,
            isLate: true,
          },
        ],
      },
      {
        tripId: 'trip-20261002-v2',
        vehicleId: 'veh-02',
        driverId: 'drv-102',
        date: '2026-10-02',
        depotId: 'depot-central',
        startDepotDepartureS: 28800,
        endDepotArrivalS: 50400, // 6 hours
        recordedOdometerKm: 42.0,
        recordedDurationS: 21600,
        stops: [
          {
            stopId: 'stop-h3',
            orderId: 'so-3',
            coordinate: { lat: 11.54, lon: 104.92 },
            actualArrivalS: 36000,
            actualDepartureS: 36300,
            slaDeadlineS: 39600, // On-time
            dwellTimeS: 300,
            weightGrams: 1500,
            isLate: false,
          },
        ],
      },
    ];

    it('reconstructs aggregate performance and financial cost from trip logs', () => {
      const baseline = HistoricalReconstructor.reconstructBaseline(
        historicalTrips,
        'Phnom-Penh-October-Baseline'
      );

      assert.equal(baseline.datasetName, 'Phnom-Penh-October-Baseline');
      assert.equal(baseline.totalDays, 2);
      assert.equal(baseline.totalTrips, 2);
      assert.equal(baseline.totalStops, 3);
      assert.equal(baseline.totalVehiclesUsed, 2);
      assert.equal(baseline.totalDistanceKm, 107.5);
      assert.equal(baseline.totalShiftHours, 13.0);
      assert.equal(baseline.onTimeStopsCount, 2);
      assert.equal(baseline.lateStopsCount, 1);
      assert.equal(baseline.onTimePercent, 66.7); // 2 out of 3

      assert.equal(baseline.financialBreakdown.vehiclesDeployed, 2);
      assert.equal(baseline.financialBreakdown.lateStopsCount, 1);
      assert.ok(baseline.financialBreakdown.totalCostCents > 0);
    });

    it('gracefully handles empty historical trip dataset', () => {
      const emptyBaseline = HistoricalReconstructor.reconstructBaseline([]);
      assert.equal(emptyBaseline.totalTrips, 0);
      assert.equal(emptyBaseline.totalStops, 0);
      assert.equal(emptyBaseline.onTimePercent, 100);
      assert.equal(emptyBaseline.financialBreakdown.totalCostCents, 0);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Model Calibration & Held-Out Evaluation
  // --------------------------------------------------------------------------
  describe('3. Model Calibration with Held-Out Evaluation', () => {
    const sampleCalibrationDataset: CalibrationDataset = {
      calibrationDays: ['2026-10-01', '2026-10-02', '2026-10-03'],
      heldOutDays: ['2026-10-04', '2026-10-05'],
      records: [
        // Calibration Days: Observed is ~20% higher than free-flow (traffic factor ~ 1.20)
        {
          id: 'rec-01',
          date: '2026-10-01',
          originCoord: { lat: 11.55, lon: 104.91 },
          destCoord: { lat: 11.56, lon: 104.92 },
          modeledFreeFlowDurationS: 600,
          observedDurationS: 720, // 1.20x
          modeledDistanceM: 5000,
          observedDwellTimeS: 180,
          packageWeightGrams: 2000,
        },
        {
          id: 'rec-02',
          date: '2026-10-02',
          originCoord: { lat: 11.56, lon: 104.92 },
          destCoord: { lat: 11.58, lon: 104.93 },
          modeledFreeFlowDurationS: 1000,
          observedDurationS: 1190, // ~1.19x
          modeledDistanceM: 8000,
          observedDwellTimeS: 210,
          packageWeightGrams: 4000,
        },
        {
          id: 'rec-03',
          date: '2026-10-03',
          originCoord: { lat: 11.58, lon: 104.93 },
          destCoord: { lat: 11.54, lon: 104.90 },
          modeledFreeFlowDurationS: 800,
          observedDurationS: 970, // ~1.21x
          modeledDistanceM: 7000,
          observedDwellTimeS: 160,
          packageWeightGrams: 1500,
        },
        // Held-Out Days: Independent evaluation
        {
          id: 'rec-04',
          date: '2026-10-04',
          originCoord: { lat: 11.55, lon: 104.92 },
          destCoord: { lat: 11.57, lon: 104.91 },
          modeledFreeFlowDurationS: 500,
          observedDurationS: 605, // 1.21x
          modeledDistanceM: 4000,
          observedDwellTimeS: 175,
          packageWeightGrams: 2000,
        },
        {
          id: 'rec-05',
          date: '2026-10-05',
          originCoord: { lat: 11.57, lon: 104.91 },
          destCoord: { lat: 11.53, lon: 104.94 },
          modeledFreeFlowDurationS: 900,
          observedDurationS: 1070, // ~1.19x
          modeledDistanceM: 7500,
          observedDwellTimeS: 195,
          packageWeightGrams: 3000,
        },
      ],
    };

    it('calibrates road travel factor on training days and validates on held-out days', () => {
      const calibrationResult = ModelCalibrator.calibrateAndEvaluate(sampleCalibrationDataset);

      // Travel factor should be close to 1.20
      assert.ok(
        calibrationResult.calibratedTravelFactor >= 1.18 &&
          calibrationResult.calibratedTravelFactor <= 1.22,
        `Expected travel factor ~1.20, got ${calibrationResult.calibratedTravelFactor}`
      );

      // Held-out MAPE should be small (< 5%)
      assert.ok(
        calibrationResult.heldOutEvaluationMetrics.travelTimeMapePercent < 5.0,
        `Expected held-out MAPE < 5%, got ${calibrationResult.heldOutEvaluationMetrics.travelTimeMapePercent}%`
      );

      // Data quality coverage should be 100%
      assert.equal(
        calibrationResult.heldOutEvaluationMetrics.dataQualityCoveragePercent,
        100.0
      );

      // Calibration status gate must pass
      assert.equal(calibrationResult.isCalibrated, true);
      assert.ok(calibrationResult.notes.length >= 3);
    });

    it('rejects uncalibrated status when data quality or MAPE violates gates', () => {
      const poorDataset: CalibrationDataset = {
        calibrationDays: ['2026-10-01'],
        heldOutDays: ['2026-10-02'],
        records: [
          {
            id: 'bad-1',
            date: '2026-10-01',
            originCoord: { lat: 11.5, lon: 104.9 },
            destCoord: { lat: 11.6, lon: 104.9 },
            modeledFreeFlowDurationS: 500,
            observedDurationS: 1000, // 2.0x
            modeledDistanceM: 5000,
            observedDwellTimeS: 200,
            packageWeightGrams: 2000,
          },
          {
            id: 'bad-2',
            date: '2026-10-02',
            originCoord: { lat: 11.5, lon: 104.9 },
            destCoord: { lat: 11.6, lon: 104.9 },
            modeledFreeFlowDurationS: 500,
            observedDurationS: 400, // 0.8x -> big error vs 2.0x model!
            modeledDistanceM: 5000,
            observedDwellTimeS: 200,
            packageWeightGrams: 2000,
          },
        ],
      };

      const result = ModelCalibrator.calibrateAndEvaluate(poorDataset);
      assert.equal(result.isCalibrated, false);
      assert.ok(
        result.notes.some((n) => n.includes('WARNING: Held-out performance did not satisfy calibration gate'))
      );
    });
  });

  // --------------------------------------------------------------------------
  // 4. Projected vs. Realized Separation & Multi-Seed Comparison
  // --------------------------------------------------------------------------
  describe('4. Projected vs Realized Separation & Common Random Numbers', () => {
    // Problem setup
    const facilities = [
      {
        id: 'depot-pnh',
        code: 'DEPOT-1',
        name: 'Central Depot',
        latitude: 11.5564,
        longitude: 104.9282,
      },
    ];

    const orders = [
      { id: 'o-1', orderNumber: 'SO-1', status: 'pending', deliveryLatitude: 11.560, deliveryLongitude: 104.915, totalWeightGrams: 2000 },
      { id: 'o-2', orderNumber: 'SO-2', status: 'pending', deliveryLatitude: 11.565, deliveryLongitude: 104.922, totalWeightGrams: 3000 },
      { id: 'o-3', orderNumber: 'SO-3', status: 'pending', deliveryLatitude: 11.572, deliveryLongitude: 104.918, totalWeightGrams: 4000 },
      { id: 'o-4', orderNumber: 'SO-4', status: 'pending', deliveryLatitude: 11.580, deliveryLongitude: 104.930, totalWeightGrams: 1000 },
      { id: 'o-5', orderNumber: 'SO-5', status: 'pending', deliveryLatitude: 11.575, deliveryLongitude: 104.898, totalWeightGrams: 5000 },
    ];

    const problem = SnapshotProblemAdapter.fromSnapshotData({
      snapshotId: 'snap-eval-1',
      tenantId: 'tenant-express',
      facilities,
      orders,
      fleetSize: 3,
    });

    const historicalTrips: HistoricalTrip[] = [
      {
        tripId: 'hist-trip-1',
        vehicleId: 'hist-v1',
        driverId: 'drv-1',
        date: '2026-10-09',
        depotId: 'depot-pnh',
        startDepotDepartureS: 28800,
        endDepotArrivalS: 57600, // 8h
        recordedOdometerKm: 45.0,
        recordedDurationS: 28800,
        stops: orders.map((o, idx) => ({
          stopId: `hist-stop-${idx}`,
          orderId: o.id,
          coordinate: { lat: o.deliveryLatitude, lon: o.deliveryLongitude },
          actualArrivalS: 32000 + idx * 3600,
          actualDepartureS: 32300 + idx * 3600,
          slaDeadlineS: 50000,
          dwellTimeS: 300,
          weightGrams: o.totalWeightGrams,
          isLate: false,
        })),
      },
    ];

    it('generates complete evaluation report cleanly separating projected vs realized outcomes', () => {
      const greedy = GreedyVrpSolver.solve(problem);
      const optimized = MetaheuristicVrpOptimizer.solve(problem, { maxIterations: 50 });

      const report = ScenarioComparator.evaluate(
        problem,
        historicalTrips,
        greedy,
        optimized,
        {
          simulationSeeds: [10, 20, 30, 40, 50],
          stochasticTrafficVariance: 0.10,
          stochasticDwellVariance: 0.15,
        }
      );

      // Verify structure
      assert.ok(report.evaluationId.startsWith('eval-'));
      assert.equal(report.historicalActual.trackName, 'HISTORICAL_ACTUAL');
      assert.equal(report.greedyBaseline.trackName, 'GREEDY_BASELINE');
      assert.equal(report.optimizedPlan.trackName, 'OPTIMIZED_PLAN');

      // Projected vs Realized separation:
      // The optimized track must have both projectedCostCents AND realizedCostStats with 95% CI
      assert.ok(report.optimizedPlan.projectedCostCents > 0);
      assert.ok(report.optimizedPlan.realizedCostStats);
      assert.ok(report.optimizedPlan.realizedCostStats.lower95 <= report.optimizedPlan.realizedCostStats.mean);
      assert.ok(report.optimizedPlan.realizedCostStats.upper95 >= report.optimizedPlan.realizedCostStats.mean);

      // Comparison report contains statistical CI and recommendation
      assert.ok(report.comparison.realizedSavingsConfidenceInterval95);
      assert.ok(report.comparison.riskSummary.recommendation.length > 0);
      assert.ok(report.comparison.projectedCostSavingsVsGreedyCents >= 0);
    });

    it('produces identical stochastic realizations when evaluated with identical seeds (CRN)', () => {
      const greedy = GreedyVrpSolver.solve(problem);
      const optimized = MetaheuristicVrpOptimizer.solve(problem, { maxIterations: 20 });

      const seeds = [100, 200, 300];
      const run1 = ScenarioComparator.evaluate(problem, historicalTrips, greedy, optimized, {
        simulationSeeds: seeds,
      });
      const run2 = ScenarioComparator.evaluate(problem, historicalTrips, greedy, optimized, {
        simulationSeeds: seeds,
      });

      // Bit-identical Monte Carlo realization vectors
      assert.deepEqual(
        run1.optimizedPlan.realizedCostSimulations,
        run2.optimizedPlan.realizedCostSimulations
      );
      assert.deepEqual(run1.optimizedPlan.realizedCostStats, run2.optimizedPlan.realizedCostStats);
    });
  });
});
