import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConstraintValidator } from '../src/validator/index.js';
import { ProblemDefinition, OptimizationResult } from '../src/types/index.js';

describe('OPT-01: Independent Constraint Validator', () => {
  const dummyProblem: ProblemDefinition = {
    id: 'prob-val-1',
    name: 'Validation Test Problem',
    tenantId: 'tenant-test',
    depots: [
      {
        id: 'depot-1',
        name: 'Main Depot',
        coordinate: { lat: 11.5564, lon: 104.9282 },
        openTimeS: 28800, // 08:00
        closeTimeS: 64800, // 18:00
      },
    ],
    vehicles: [
      {
        id: 'veh-1',
        name: 'Van 1',
        capacityUnits: 10,
        maxShiftDurationS: 28800, // 8 hours
        startDepotId: 'depot-1',
        endDepotId: 'depot-1',
        fixedCostCents: 5000,
        costPerKmCents: 100,
        costPerHourCents: 1500,
      },
    ],
    stops: [
      {
        id: 'stop-1',
        orderId: 'ord-1',
        coordinate: { lat: 11.5600, lon: 104.9200 },
        demandUnits: 5,
        earliestArrivalS: 29000,
        latestArrivalS: 36000,
        serviceDurationS: 600,
      },
      {
        id: 'stop-2',
        orderId: 'ord-2',
        coordinate: { lat: 11.5700, lon: 104.9100 },
        demandUnits: 7, // 5 + 7 = 12 > capacity 10!
        earliestArrivalS: 30000,
        latestArrivalS: 38000,
        serviceDurationS: 600,
      },
    ],
    matrix: {
      coordinates: [],
      durationsS: [],
      distancesM: [],
      graphVersion: 'test-v1',
      costModelVersion: 'test-v1',
    },
    coordIndexMap: {},
  };

  it('detects cumulative vehicle capacity violations', () => {
    const invalidResult: OptimizationResult = {
      problemId: 'prob-val-1',
      status: 'FEASIBLE',
      algorithm: 'test_solver',
      executionTimeMs: 10,
      objectiveCostCents: 10000,
      unassignedStops: [],
      summary: {
        totalVehiclesUsed: 1,
        totalStopsServiced: 2,
        totalDistanceKm: 10,
        totalDrivingHours: 1,
        totalCostCents: 10000,
        slaCompliancePercent: 100,
      },
      routes: [
        {
          vehicleId: 'veh-1',
          startDepotId: 'depot-1',
          endDepotId: 'depot-1',
          totalDistanceM: 10000,
          totalDurationS: 3600,
          drivingDurationS: 2400,
          waitingDurationS: 0,
          serviceDurationS: 1200,
          peakLoadUnits: 12, // exceeds 10
          fixedCostCents: 5000,
          variableDistanceCostCents: 1000,
          variableTimeCostCents: 1500,
          totalCostCents: 7500,
          visits: [
            {
              stopId: 'stop-1',
              coordinate: { lat: 11.5600, lon: 104.9200 },
              demandUnits: 5,
              arrivalTimeS: 30000,
              serviceStartTimeS: 30000,
              departureTimeS: 30600,
              waitingTimeS: 0,
              cumulativeLoadUnits: 5,
              distanceFromPreviousM: 3000,
              travelTimeFromPreviousS: 600,
            },
            {
              stopId: 'stop-2',
              coordinate: { lat: 11.5700, lon: 104.9100 },
              demandUnits: 7,
              arrivalTimeS: 31200,
              serviceStartTimeS: 31200,
              departureTimeS: 31800,
              waitingTimeS: 0,
              cumulativeLoadUnits: 12, // Exceeds 10
              distanceFromPreviousM: 4000,
              travelTimeFromPreviousS: 600,
            },
          ],
        },
      ],
    };

    const report = ConstraintValidator.validatePlan(dummyProblem, invalidResult);
    assert.equal(report.isValid, false);
    const capacityViolation = report.violations.find((v) => v.type === 'CAPACITY_EXCEEDED');
    assert.ok(capacityViolation);
    assert.match(capacityViolation.details, /exceeds vehicle capacity 10/);
  });

  it('detects late arrival time window (SLA deadline) violations', () => {
    const invalidResult: OptimizationResult = {
      problemId: 'prob-val-1',
      status: 'FEASIBLE',
      algorithm: 'test_solver',
      executionTimeMs: 10,
      objectiveCostCents: 10000,
      unassignedStops: [],
      summary: {
        totalVehiclesUsed: 1,
        totalStopsServiced: 1,
        totalDistanceKm: 5,
        totalDrivingHours: 1,
        totalCostCents: 10000,
        slaCompliancePercent: 100,
      },
      routes: [
        {
          vehicleId: 'veh-1',
          startDepotId: 'depot-1',
          endDepotId: 'depot-1',
          totalDistanceM: 5000,
          totalDurationS: 3600,
          drivingDurationS: 2400,
          waitingDurationS: 0,
          serviceDurationS: 600,
          peakLoadUnits: 5,
          fixedCostCents: 5000,
          variableDistanceCostCents: 500,
          variableTimeCostCents: 1500,
          totalCostCents: 7000,
          visits: [
            {
              stopId: 'stop-1',
              coordinate: { lat: 11.5600, lon: 104.9200 },
              demandUnits: 5,
              arrivalTimeS: 40000, // latestArrivalS is 36000! Late!
              serviceStartTimeS: 40000,
              departureTimeS: 40600,
              waitingTimeS: 0,
              cumulativeLoadUnits: 5,
              distanceFromPreviousM: 3000,
              travelTimeFromPreviousS: 600,
            },
          ],
        },
      ],
    };

    const report = ConstraintValidator.validatePlan(dummyProblem, invalidResult);
    assert.equal(report.isValid, false);
    const timeViolation = report.violations.find((v) => v.type === 'TIME_WINDOW_VIOLATED');
    assert.ok(timeViolation);
    assert.match(timeViolation.details, /exceeds latest allowed SLA deadline/);
  });

  it('detects shift duration exceeded violations', () => {
    const invalidResult: OptimizationResult = {
      problemId: 'prob-val-1',
      status: 'FEASIBLE',
      algorithm: 'test_solver',
      executionTimeMs: 10,
      objectiveCostCents: 10000,
      unassignedStops: [],
      summary: {
        totalVehiclesUsed: 1,
        totalStopsServiced: 1,
        totalDistanceKm: 5,
        totalDrivingHours: 10,
        totalCostCents: 10000,
        slaCompliancePercent: 100,
      },
      routes: [
        {
          vehicleId: 'veh-1',
          startDepotId: 'depot-1',
          endDepotId: 'depot-1',
          totalDistanceM: 5000,
          totalDurationS: 36000, // 10 hours > maxShiftDuration 8 hours (28800s)
          drivingDurationS: 30000,
          waitingDurationS: 0,
          serviceDurationS: 600,
          peakLoadUnits: 5,
          fixedCostCents: 5000,
          variableDistanceCostCents: 500,
          variableTimeCostCents: 1500,
          totalCostCents: 7000,
          visits: [
            {
              stopId: 'stop-1',
              coordinate: { lat: 11.5600, lon: 104.9200 },
              demandUnits: 5,
              arrivalTimeS: 32000,
              serviceStartTimeS: 32000,
              departureTimeS: 32600,
              waitingTimeS: 0,
              cumulativeLoadUnits: 5,
              distanceFromPreviousM: 3000,
              travelTimeFromPreviousS: 600,
            },
          ],
        },
      ],
    };

    const report = ConstraintValidator.validatePlan(dummyProblem, invalidResult);
    assert.equal(report.isValid, false);
    const shiftViolation = report.violations.find((v) => v.type === 'SHIFT_DURATION_EXCEEDED');
    assert.ok(shiftViolation);
    assert.match(shiftViolation.details, /exceeds maximum vehicle shift/);
  });
});
