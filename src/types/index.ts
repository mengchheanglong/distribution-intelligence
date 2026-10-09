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
