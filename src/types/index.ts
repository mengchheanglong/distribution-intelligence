/**
 * @fileoverview Domain types and interfaces for the VRPTW Solver and Constraint Optimizer.
 */

export interface Coordinate {
  lat: number;
  lon: number;
}

export interface Depot {
  id: string;
  name: string;
  coordinate: Coordinate;
  openTimeS: number;
  closeTimeS: number;
}

export interface Vehicle {
  id: string;
  name: string;
  capacityUnits: number;
  maxShiftDurationS: number;
  startDepotId: string;
  endDepotId: string;
  fixedCostCents: number;
  costPerKmCents: number;
  costPerHourCents: number;
}

export interface ShipmentStop {
  id: string;
  orderId: string;
  coordinate: Coordinate;
  demandUnits: number;
  earliestArrivalS: number;
  latestArrivalS: number;
  serviceDurationS: number;
}

export interface CostMatrix {
  /** Geographic coordinate index lookup */
  coordinates: Coordinate[];
  /** Travel durations in seconds between coordinate[i] and coordinate[j] */
  durationsS: (number | null)[][];
  /** Travel distances in meters between coordinate[i] and coordinate[j] */
  distancesM: (number | null)[][];
  graphVersion: string;
  costModelVersion: string;
}

export interface ProblemDefinition {
  id: string;
  name: string;
  tenantId: string;
  depots: Depot[];
  vehicles: Vehicle[];
  stops: ShipmentStop[];
  matrix: CostMatrix;
  /** Map from entity coordinate key (lat,lon) to matrix index */
  coordIndexMap: Record<string, number>;
}

export interface StopVisit {
  stopId: string;
  coordinate: Coordinate;
  demandUnits: number;
  arrivalTimeS: number;
  serviceStartTimeS: number;
  departureTimeS: number;
  waitingTimeS: number;
  cumulativeLoadUnits: number;
  distanceFromPreviousM: number;
  travelTimeFromPreviousS: number;
}

export interface VehicleRoute {
  vehicleId: string;
  startDepotId: string;
  endDepotId: string;
  visits: StopVisit[];
  totalDistanceM: number;
  totalDurationS: number;
  drivingDurationS: number;
  waitingDurationS: number;
  serviceDurationS: number;
  peakLoadUnits: number;
  fixedCostCents: number;
  variableDistanceCostCents: number;
  variableTimeCostCents: number;
  totalCostCents: number;
}

export type SolverStatus = 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'TIMEOUT';

export interface UnassignedStop {
  stopId: string;
  reason: string;
}

export interface OptimizationResult {
  problemId: string;
  status: SolverStatus;
  algorithm: string;
  executionTimeMs: number;
  routes: VehicleRoute[];
  unassignedStops: UnassignedStop[];
  objectiveCostCents: number;
  summary: {
    totalVehiclesUsed: number;
    totalStopsServiced: number;
    totalDistanceKm: number;
    totalDrivingHours: number;
    totalCostCents: number;
    slaCompliancePercent: number;
  };
}

export interface ConstraintViolation {
  type: 'CAPACITY_EXCEEDED' | 'TIME_WINDOW_VIOLATED' | 'SHIFT_DURATION_EXCEEDED' | 'DEPOT_WINDOW_VIOLATED' | 'INVALID_DEPOT' | 'DUPLICATE_VISIT';
  vehicleId?: string;
  stopId?: string;
  details: string;
}

export interface ValidationReport {
  isValid: boolean;
  violations: ConstraintViolation[];
}

export interface PlanComparison {
  baselineAlgorithm: string;
  optimizedAlgorithm: string;
  deltaCostCents: number;
  costSavingsPercent: number;
  deltaVehicles: number;
  deltaDistanceKm: number;
  deltaDrivingHours: number;
  baselineValid: boolean;
  optimizedValid: boolean;
  summary: string;
}

// ============================================================================
// EVAL-01: Cost-to-Serve, Historical Reconstruction, Calibration & Comparison
// ============================================================================

export interface CostModelParameters {
  /** Fixed overhead per vehicle deployed per operating day (in integer cents) */
  fixedCostPerVehicleDayCents: number;
  /** Variable wear, fuel, and maintenance cost per kilometer (in integer cents) */
  fuelAndMaintenancePerKmCents: number;
  /** Regular driver wage per hour of shift time (in integer cents) */
  driverHourlyWageCents: number;
  /** Overtime driver wage per hour beyond standard shift (in integer cents) */
  overtimeHourlyWageCents: number;
  /** Standard regular shift threshold before overtime applies (seconds, default 28,800s = 8h) */
  standardShiftDurationS: number;
  /** Penalty cost incurred per late customer delivery (in integer cents) */
  lateArrivalPenaltyPerStopCents: number;
  /** Penalty cost incurred per unassigned / dropped order (in integer cents) */
  unassignedStopPenaltyCents: number;
}

export interface CostToServeBreakdown {
  vehiclesDeployed: number;
  totalDistanceKm: number;
  totalShiftHours: number;
  regularHours: number;
  overtimeHours: number;
  lateStopsCount: number;
  unassignedStopsCount: number;
  fixedVehicleCostCents: number;
  distanceCostCents: number;
  regularLaborCostCents: number;
  overtimeLaborCostCents: number;
  latePenaltyCostCents: number;
  unassignedPenaltyCostCents: number;
  totalCostCents: number;
  averageCostPerStopCents: number;
  averageCostPerKmCents: number;
}

export interface HistoricalStopExecution {
  stopId: string;
  orderId: string;
  coordinate: Coordinate;
  plannedArrivalS?: number;
  actualArrivalS: number;
  actualDepartureS: number;
  slaDeadlineS: number;
  dwellTimeS: number;
  weightGrams: number;
  isLate: boolean;
}

export interface HistoricalTrip {
  tripId: string;
  vehicleId: string;
  driverId: string;
  date: string; // YYYY-MM-DD
  depotId: string;
  startDepotDepartureS: number;
  endDepotArrivalS: number;
  recordedOdometerKm: number;
  recordedDurationS: number;
  stops: HistoricalStopExecution[];
}

export interface HistoricalBaselineReport {
  datasetName: string;
  totalDays: number;
  totalTrips: number;
  totalStops: number;
  totalVehiclesUsed: number;
  totalDistanceKm: number;
  totalShiftHours: number;
  onTimeStopsCount: number;
  lateStopsCount: number;
  onTimePercent: number;
  financialBreakdown: CostToServeBreakdown;
}

export interface CalibrationDataPoint {
  id: string;
  date: string;
  originCoord: Coordinate;
  destCoord: Coordinate;
  modeledFreeFlowDurationS: number;
  observedDurationS: number;
  modeledDistanceM: number;
  observedDwellTimeS: number;
  packageWeightGrams: number;
  hasAnomalies?: boolean;
}

export interface CalibrationDataset {
  calibrationDays: string[];
  heldOutDays: string[];
  records: CalibrationDataPoint[];
}

export interface CalibrationMetrics {
  sampleSize: number;
  /** Mean Absolute Percentage Error (%) */
  travelTimeMapePercent: number;
  /** Prediction Bias / Mean Percentage Error (%) */
  travelTimeBiasPercent: number;
  /** Mean Absolute Percentage Error for stop dwell/service time (%) */
  dwellTimeMapePercent: number;
  /** Percentage of valid, anomaly-free historical records (0 - 100%) */
  dataQualityCoveragePercent: number;
}

export interface CalibrationResult {
  calibratedTravelFactor: number;
  calibratedBaseServiceTimeS: number;
  servicePerKgFactorS: number;
  calibrationSetMetrics: CalibrationMetrics;
  heldOutEvaluationMetrics: CalibrationMetrics;
  isCalibrated: boolean;
  notes: string[];
}

export interface MonteCarloConfidenceInterval {
  mean: number;
  stdError: number;
  lower95: number;
  upper95: number;
}

export interface ScenarioEvaluationTrack {
  trackName: 'HISTORICAL_ACTUAL' | 'GREEDY_BASELINE' | 'OPTIMIZED_PLAN';
  algorithm: string;
  vehiclesCount: number;
  distanceKm: number;
  shiftHours: number;
  onTimePercent: number;
  projectedCostCents: number;
  costBreakdown: CostToServeBreakdown;
  realizedCostSimulations?: number[];
  realizedCostStats?: MonteCarloConfidenceInterval;
}

export interface EvaluationReport {
  evaluationId: string;
  evaluationDate: string;
  financialAssumptions: CostModelParameters;
  historicalActual: ScenarioEvaluationTrack;
  greedyBaseline: ScenarioEvaluationTrack;
  optimizedPlan: ScenarioEvaluationTrack;
  comparison: {
    projectedCostSavingsVsActualCents: number;
    projectedSavingsPercentVsActual: number;
    projectedCostSavingsVsGreedyCents: number;
    projectedSavingsPercentVsGreedy: number;
    realizedExpectedSavingsVsActualCents: number;
    realizedSavingsConfidenceInterval95: MonteCarloConfidenceInterval;
    riskSummary: {
      slaBreachProbability: number;
      projectedVsRealizedDeltaCents: number;
      recommendation: string;
    };
  };
}

