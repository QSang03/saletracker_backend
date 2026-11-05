import assert from 'node:assert/strict';
import { OrderCareStatsService } from '../dist/order-care/order-care-stats.service.js';

function makeService(user, blacklist = new Map(), queryImpl) {
  const calls = [];
  const dataSource = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return queryImpl ? queryImpl(sql, params) : [];
    },
  };
  const orderService = {
    getUserIdsByRole: async () => user?.allowed ?? null,
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
  const { service, calls } = makeService(
    sale,
    new Map([['zalo-1', new Set(['c1', 'c2'])]]),
  );
  await service.getOverview(sale, {
    period: 'week',
    isProject: '0',
    scope: 'created',
    employees: '7,8',
    departments: '1,2',
  });
  calls.forEach(assertPlaceholders);
}

{
  // Regression cho công thức coverage/conversion mới với demand_cared.
  const orderRows = [
    { status: 'quoted', is_project: 0, care_count: 0, sale_by: 7, full_name: 'Sale A', bucket: '2026-11', c: 10 },
    { status: 'cared', is_project: 0, care_count: 2, sale_by: 7, full_name: 'Sale A', bucket: '2026-11', c: 5 },
    { status: 'completed', is_project: 0, care_count: 1, sale_by: 7, full_name: 'Sale A', bucket: '2026-11', c: 4 },
    { status: 'rejected', is_project: 0, care_count: 1, sale_by: 7, full_name: 'Sale A', bucket: '2026-11', c: 2 },
    { status: 'demand', is_project: 0, care_count: 0, sale_by: 7, full_name: 'Sale A', bucket: '2026-11', c: 3 },
    { status: 'demand_cared', is_project: 0, care_count: 1, sale_by: 7, full_name: 'Sale A', bucket: '2026-11', c: 2 },
  ];

  const { service } = makeService(admin, new Map(), (sql) => {
    if (sql.includes('SELECT od.status AS status')) return orderRows;
    // Check timeline trước: query timeline cũng có "COUNT(*) AS careActions".
    if (sql.includes('DATE_FORMAT(ci.cared_at')) return [];
    if (sql.includes('DATE_FORMAT(sh.changed_at')) return [];
    if (sql.includes('COUNT(*) AS careActions')) {
      return [
        { careActions: 18, ordersCaredInPeriod: 11, careBatches: 5 },
      ];
    }
    return [];
  });

  const { totals } = await service.getOverview(admin, {
    period: 'month',
    isProject: '0',
    scope: 'created',
  });

  assert.equal(totals.orders, 26);
  assert.equal(totals.unclosedOrders, 15);
  assert.equal(totals.uncaredUnclosedOrders, 10);
  assert.equal(totals.caredOrders, 13);
  assert.equal(totals.completedFromCare, 4);
  assert.equal(totals.rejectedFromCare, 2);
  assert.equal(totals.demandOrders, 5); // demand 3 + demand_cared 2
  assert.equal(totals.demandCaredOrders, 2);
  assert.equal(totals.uncaredDemandOrders, 3);
  assert.equal(totals.activeCaredOrders, 5);
  assert.equal(totals.rejectedOrders, 2);

  // coverage = 13 / (13 + 10 + 3)
  assert.equal(totals.careCoverageRate, 0.5);
  // conversion = 4 / (4 + 5 + 2); demand/demand_cared bị loại.
  assert.equal(totals.careConversionRate, 4 / 11);
}

console.log('✅ order-care stats SQL placeholders + metrics OK');
