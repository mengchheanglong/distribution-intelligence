import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../src/server.js';

describe('Server: Distribution Intelligence REST Endpoints', () => {
  const TEST_PORT = 3201;

  before(() => {
    return new Promise<void>((resolve) => {
      server.listen(TEST_PORT, '127.0.0.1', () => resolve());
    });
  });

  after(() => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('GET /api/health returns ready status and capabilities', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ready');
    assert.equal(data.service, '@fleet-route-optimizer/core');
    assert.ok(data.algorithms.includes('MetaheuristicVrpOptimizer'));
  });

  it('POST /api/optimizer/demo-scenario solves scenario and returns full evaluation', async () => {
    const res = await fetch(`http://127.0.0.1:${TEST_PORT}/api/optimizer/demo-scenario`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stopsCount: 10, fleetSize: 3 }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.problem);
    assert.ok(data.greedyResult);
    assert.ok(data.optimizedResult);
    assert.ok(data.comparison);
    assert.ok(data.evaluationReport);

    // Verify comparison numbers
    assert.ok(data.comparison.costSavingsPercent >= 0);
    assert.ok(data.evaluationReport.comparison.realizedSavingsConfidenceInterval95);
  });
});
