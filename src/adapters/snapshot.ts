/**
 * @fileoverview Snapshot Adapter.
 *
 * Ingests approved immutable planning snapshots (DATA-02) and directed
 * routing cost matrices (ROUTE-01) into strongly typed ProblemDefinitions.
 */

import { ProblemDefinition, Depot, Vehicle, ShipmentStop, CostMatrix } from '../types/index.js';

export interface SnapshotFacilityPayload {
  id: string;
  code: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface SnapshotOrderPayload {
  id: string;
  orderNumber: string;
  status: string;
  deliveryLatitude?: number;
  deliveryLongitude?: number;
  requiredDeliveryDate?: string;
  totalWeightGrams?: number;
}

export class SnapshotProblemAdapter {
  public static fromSnapshotData(params: {
    snapshotId: string;
    tenantId: string;
    facilities: SnapshotFacilityPayload[];
    orders: SnapshotOrderPayload[];
    fleetSize?: number;
    matrix?: CostMatrix;
  }): ProblemDefinition {
    const { snapshotId, tenantId, facilities, orders, fleetSize = 5 } = params;

    const depots: Depot[] = facilities.map((f, i) => ({
      id: f.id || `depot-${i + 1}`,
      name: f.name || f.code || `Depot ${i + 1}`,
      coordinate: { lat: f.latitude, lon: f.longitude },
      openTimeS: 7 * 3600, // 07:00 AM
      closeTimeS: 19 * 3600, // 07:00 PM
    }));

    const primaryDepot = depots[0] || {
      id: 'depot-primary',
      name: 'Primary Hub',
      coordinate: { lat: 11.5564, lon: 104.9282 },
      openTimeS: 7 * 3600,
      closeTimeS: 19 * 3600,
    };

    const vehicles: Vehicle[] = Array.from({ length: fleetSize }, (_, i) => ({
      id: `veh-${i + 1}`,
      name: `Delivery Van ${i + 1}`,
      capacityUnits: 15,
      maxShiftDurationS: 8 * 3600, // 8 hour shift
      startDepotId: primaryDepot.id,
      endDepotId: primaryDepot.id,
      fixedCostCents: 5000, // $50.00 base dispatch cost
      costPerKmCents: 120, // $1.20 per km
      costPerHourCents: 1500, // $15.00 per hour
    }));

    const stops: ShipmentStop[] = orders
      .filter((o) => typeof o.deliveryLatitude === 'number' && typeof o.deliveryLongitude === 'number')
      .map((o, i) => ({
        id: `stop-${o.id || i + 1}`,
        orderId: o.id || o.orderNumber,
        coordinate: { lat: o.deliveryLatitude!, lon: o.deliveryLongitude! },
        demandUnits: Math.max(1, Math.round((o.totalWeightGrams || 1000) / 1000)),
        earliestArrivalS: 8 * 3600, // 08:00 AM
        latestArrivalS: 17 * 3600, // 05:00 PM
        serviceDurationS: 600, // 10 minutes service time
      }));

    // Build coordinate index map
    const coordinates: { lat: number; lon: number }[] = [
      ...depots.map((d) => d.coordinate),
      ...stops.map((s) => s.coordinate),
    ];

    const coordIndexMap: Record<string, number> = {};
    coordinates.forEach((c, idx) => {
      coordIndexMap[`${c.lat.toFixed(6)},${c.lon.toFixed(6)}`] = idx;
    });

    // If no external matrix provided, build default euclidean-derived matrix
    let matrix = params.matrix;
    if (!matrix) {
      const N = coordinates.length;
      const durationsS: (number | null)[][] = [];
      const distancesM: (number | null)[][] = [];

      for (let i = 0; i < N; i++) {
        durationsS[i] = [];
        distancesM[i] = [];
        for (let j = 0; j < N; j++) {
          if (i === j) {
            durationsS[i][j] = 0;
            distancesM[i][j] = 0;
          } else {
            const dLat = (coordinates[i].lat - coordinates[j].lat) * 111320;
            const dLon = (coordinates[i].lon - coordinates[j].lon) * 110574;
            const dist = Math.hypot(dLat, dLon) * 1.3; // road curvature factor
            const dur = (dist / 8.33); // ~30 km/h average city speed
            distancesM[i][j] = Math.round(dist);
            durationsS[i][j] = Math.round(dur);
          }
        }
      }

      matrix = {
        coordinates,
        durationsS,
        distancesM,
        graphVersion: 'synthetic-snapshot-matrix-v1.0',
        costModelVersion: 'tdsp-snapshot-v1.0',
      };
    }

    return {
      id: `problem-${snapshotId}`,
      name: `Snapshot ${snapshotId} Planning Problem`,
      tenantId,
      depots,
      vehicles,
      stops,
      matrix,
      coordIndexMap,
    };
  }
}
