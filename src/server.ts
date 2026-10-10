/**
 * @fileoverview Standalone HTTP service for @distribution-intelligence/core.
 * Exposes REST endpoints for VRPTW constraint optimization, greedy baseline comparison,
 * and EVAL-01 financial cost-to-serve scenario evaluation.
 */

import http from 'node:http';
import {
  SnapshotProblemAdapter,
  GreedyVrpSolver,
  MetaheuristicVrpOptimizer,
  ConstraintValidator,
  PlanComparator,
  FinancialCostModel,
  ScenarioComparator,
  DEFAULT_COST_PARAMETERS,
  type ProblemDefinition,
  type HistoricalTrip,
} from './index.js';

const PORT = Number(process.env.PORT || 3200);

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        // 5MB limit
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

export function createDemoProblem(params?: {
  stopsCount?: number;
  fleetSize?: number;
  seed?: number;
}): ProblemDefinition {
  const count = params?.stopsCount ?? 12;
  const fleetSize = params?.fleetSize ?? 4;

  const facilities = [
    {
      id: 'depot-pnh-central',
      code: 'DEPOT-PNH-01',
      name: 'Phnom Penh Central Distribution Center',
      latitude: 11.5564,
      longitude: 104.9282,
    },
  ];

  // Realistic delivery locations dispersed around Phnom Penh urban sectors
  const urbanNodes = [
    { lat: 11.5600, lon: 104.9150, weight: 2000, name: 'BKK1 Commercial Drop' },
    { lat: 11.5650, lon: 104.9220, weight: 3000, name: 'Riverside Retail Hub' },
    { lat: 11.5720, lon: 104.9180, weight: 4000, name: 'Wat Phnom Business Center' },
    { lat: 11.5800, lon: 104.9300, weight: 1500, name: 'Toul Kork Depot Parcel' },
    { lat: 11.5750, lon: 104.8980, weight: 3500, name: 'Sen Sok Distribution Point' },
    { lat: 11.5435, lon: 104.9142, weight: 2500, name: 'Russian Market Vendor' },
    { lat: 11.5510, lon: 104.9350, weight: 3000, name: 'Diamond Island (Koh Pich)' },
    { lat: 11.5380, lon: 104.9260, weight: 2000, name: 'Boeung Tumpun Depo' },
    { lat: 11.5620, lon: 104.9400, weight: 4500, name: 'Chroy Changvar Logistics Node' },
    { lat: 11.5480, lon: 104.9050, weight: 3000, name: 'Stung Meanchey Depot' },
    { lat: 11.5680, lon: 104.9090, weight: 2200, name: 'Olympic Stadium Express' },
    { lat: 11.5850, lon: 104.9120, weight: 3800, name: 'Kilometer 6 North Terminal' },
    { lat: 11.5320, lon: 104.9180, weight: 1800, name: 'Chak Angre Krom Store' },
    { lat: 11.5550, lon: 104.8920, weight: 4000, name: 'Chaom Chau Outpost' },
    { lat: 11.5910, lon: 104.9350, weight: 2500, name: 'Prek Pnov Delivery' },
  ];

  const selectedNodes = urbanNodes.slice(0, Math.min(count, urbanNodes.length));

  const orders = selectedNodes.map((n, idx) => ({
    id: `ord-opt-${String(idx + 1).padStart(2, '0')}`,
    orderNumber: `SO-${1000 + idx + 1}`,
    status: 'pending',
    deliveryLatitude: n.lat,
    deliveryLongitude: n.lon,
    totalWeightGrams: n.weight,
  }));

  return SnapshotProblemAdapter.fromSnapshotData({
    snapshotId: `snap-pnh-${Date.now().toString(36)}`,
    tenantId: 'tenant-kh-express',
    facilities,
    orders,
    fleetSize,
  });
}

export function createHistoricalTrips(problem: ProblemDefinition): HistoricalTrip[] {
  // Reconstruct representative historical baseline matching the problem stops
  return [
    {
      tripId: 'hist-trip-01',
      vehicleId: 'veh-legacy-01',
      driverId: 'drv-sopheap',
      date: new Date().toISOString().slice(0, 10),
      depotId: problem.depots[0]?.id || 'depot-pnh-central',
      startDepotDepartureS: 28800, // 08:00 AM
      endDepotArrivalS: 61200, // 17:00 PM (9.0h)
      recordedOdometerKm: 58.4,
      recordedDurationS: 32400,
      stops: problem.stops.map((s, idx) => ({
        stopId: `hist-stop-${idx + 1}`,
        orderId: s.orderId,
        coordinate: s.coordinate,
        actualArrivalS: 32000 + idx * 2400,
        actualDepartureS: 32600 + idx * 2400,
        slaDeadlineS: 54000,
        dwellTimeS: 600,
        weightGrams: s.demandUnits * 1000,
        isLate: false,
      })),
    },
  ];
}

export const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = url.pathname;

  try {
    // 1. Health check
    if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
      sendJson(res, 200, {
        schemaVersion: 1,
        status: 'ready',
        service: '@distribution-intelligence/core',
        version: '0.1.0',
        algorithms: ['GreedyVrpSolver', 'MetaheuristicVrpOptimizer'],
        evaluators: ['PlanComparator', 'FinancialCostModel', 'ScenarioComparator'],
      });
      return;
    }

    // 2. Solve VRPTW
    if (req.method === 'POST' && pathname === '/api/optimizer/solve') {
      const body = await parseJsonBody(req);
      const problem: ProblemDefinition = body.problem || createDemoProblem(body);
      const algorithm = body.algorithm || 'metaheuristic';
      const maxIterations = Number(body.maxIterations || 100);

      const result =
        algorithm === 'greedy'
          ? GreedyVrpSolver.solve(problem)
          : MetaheuristicVrpOptimizer.solve(problem, { maxIterations });

      const validation = ConstraintValidator.validatePlan(problem, result);

      sendJson(res, 200, {
        problemId: problem.id,
        result,
        validation,
      });
      return;
    }

    // 3. Compare Greedy vs Metaheuristic
    if (req.method === 'POST' && pathname === '/api/optimizer/compare') {
      const body = await parseJsonBody(req);
      const problem: ProblemDefinition = body.problem || createDemoProblem(body);
      const maxIterations = Number(body.maxIterations || 100);

      const greedyResult = GreedyVrpSolver.solve(problem);
      const optimizedResult = MetaheuristicVrpOptimizer.solve(problem, { maxIterations });
      const comparison = PlanComparator.compare(problem, greedyResult, optimizedResult);

      sendJson(res, 200, {
        problem,
        greedyResult,
        optimizedResult,
        comparison,
      });
      return;
    }

    // 4. Scenario Evaluation & Cost-to-Serve (EVAL-01)
    if (req.method === 'POST' && pathname === '/api/optimizer/evaluate') {
      const body = await parseJsonBody(req);
      const problem: ProblemDefinition = body.problem || createDemoProblem(body);
      const historicalTrips: HistoricalTrip[] = body.historicalTrips || createHistoricalTrips(problem);
      const maxIterations = Number(body.maxIterations || 100);

      const greedyResult = GreedyVrpSolver.solve(problem);
      const optimizedResult = MetaheuristicVrpOptimizer.solve(problem, { maxIterations });
      const comparison = PlanComparator.compare(problem, greedyResult, optimizedResult);

      const report = ScenarioComparator.evaluate(
        problem,
        historicalTrips,
        greedyResult,
        optimizedResult,
        {
          costParams: body.costParameters || DEFAULT_COST_PARAMETERS,
          simulationSeeds: [10, 20, 30, 40, 50],
          stochasticTrafficVariance: 0.10,
          stochasticDwellVariance: 0.15,
        }
      );

      sendJson(res, 200, {
        problem,
        greedyResult,
        optimizedResult,
        comparison,
        evaluationReport: report,
      });
      return;
    }

    // 5. One-stop Demo Scenario Generator & Solver
    if (req.method === 'POST' && pathname === '/api/optimizer/demo-scenario') {
      const body = await parseJsonBody(req);
      const stopsCount = Math.min(25, Math.max(5, Number(body.stopsCount || 12)));
      const fleetSize = Math.min(8, Math.max(2, Number(body.fleetSize || 4)));

      const problem = createDemoProblem({ stopsCount, fleetSize });
      const historicalTrips = createHistoricalTrips(problem);

      const greedyResult = GreedyVrpSolver.solve(problem);
      const optimizedResult = MetaheuristicVrpOptimizer.solve(problem, { maxIterations: 80 });
      const comparison = PlanComparator.compare(problem, greedyResult, optimizedResult);

      const report = ScenarioComparator.evaluate(
        problem,
        historicalTrips,
        greedyResult,
        optimizedResult,
        {
          costParams: DEFAULT_COST_PARAMETERS,
          simulationSeeds: [11, 22, 33, 44, 55],
          stochasticTrafficVariance: 0.08,
          stochasticDwellVariance: 0.12,
        }
      );

      sendJson(res, 200, {
        problem,
        greedyResult,
        optimizedResult,
        comparison,
        evaluationReport: report,
      });
      return;
    }

    // 404 for other routes
    sendJson(res, 404, { error: 'Route not found' });
  } catch (err: any) {
    sendJson(res, 500, {
      error: 'Internal solver error',
      message: err?.message || String(err),
    });
  }
});

if (process.env.NODE_ENV !== 'test' && process.argv[1]?.endsWith('server.js')) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[distribution-intelligence] Solver service listening on http://127.0.0.1:${PORT}`);
  });
}
