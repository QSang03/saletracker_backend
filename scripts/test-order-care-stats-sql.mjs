import assert from 'node:assert/strict';
import { OrderCareStatsService } from '../dist/order-care/order-care-stats.service.js';

function makeService(user, blacklist = new Map()) {
  const calls = [];
  const dataSource = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [];
    },
  };
  const orderService = {
    getUserIdsByRole: async () => (user?.allowed ?? null),
  };
  const blacklistService = {
    getBlacklistedContactsForUsers: async () => blacklist,
  };
  const redisService = {
    get: async () => null,
    set: async () => undefined,
  };
  const service = new OrderCareStatsService(
    dataSource,
    orderService,
    blacklistService,
    redisService,
  );
  return { service, calls };
}

function assertPlaceholders(call) {
  const count = (call.sql.match(/\?/g) || []).length;
  assert.equal(
    count,
    call.params.length,
    `placeholder mismatch: ${count} ? vs ${call.params.length} params\n${call.sql}`,
  );
}

const admin = { roles: [{ name: 'admin' }], id: 1 };
const sale = { roles: [{ name: 'user' }], id: 7, allowed: [7] };

for (const scope of ['created', 'all']) {
  for (const isProject of ['0', '1', 'all']) {
    const { service, calls } = makeService(admin);
    const result = await service.getOverview(admin, {
      period: 'month',
      isProject,
      scope,
    });
    assert.equal(result.scope.isProject, isProject);
    // order stats gộp + care totals + care timeline + completions
    assert.equal(calls.length, 4);
    calls.forEach(assertPlaceholders);
  }
}

{
  const { service, calls } = makeService(sale, new Map([['zalo-1', new Set(['c1', 'c2'])]]));
  await service.getOverview(sale, {
    period: 'week',
    isProject: '0',
    scope: 'created',
    employees: '7,8',
    departments: '1,2',
  });
  calls.forEach(assertPlaceholders);
}

console.log('✅ order-care stats SQL placeholders OK');
