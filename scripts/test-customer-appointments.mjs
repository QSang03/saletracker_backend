// Offline regression tests; no DB connection, HTTP calls or production writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
require('tsconfig-paths').register({
  baseUrl: fileURLToPath(new URL('../dist/', import.meta.url)),
  paths: { 'src/*': ['*'] },
});
const policy = require('../dist/customer-kpi/appointment-policy.js');
const {
  CustomerAppointmentsService,
} = require('../dist/customer-kpi/customer-appointments.service.js');
const {
  CustomerAppointment,
  CustomerAppointmentSyncState,
} = require('../dist/customer-kpi/customer-appointment.entity.js');
const { Customer } = require('../dist/customer-kpi/customer.entity.js');
const { User } = require('../dist/users/user.entity.js');
const { NkmSaleMap } = require('../dist/customer-kpi/nkm-sale-map.entity.js');
const {
  CustomerKpiScoringService,
} = require('../dist/customer-kpi/customer-kpi-scoring.service.js');
const {
  CustomerKpiReportsService,
} = require('../dist/customer-kpi/customer-kpi-reports.service.js');
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}
const maps = [{ slp_code: 251, employee_code: 'NKDS55', is_active: true }];
const users = [{ id: 57, employeeCode: 'NKDS55', deletedAt: null }];
const customers = [
  { id: 8, customer_code: 'HQC_TEST', sap_code: 'C8', status: 'active' },
  { id: 9, customer_code: 'HQC_TEST', sap_code: 'C9', status: 'active' },
];
const appointment = (o = {}) => ({
  appointment_id: 6,
  appointment_code: 'LH00006',
  title: 'Gặp khách',
  status: 'completed',
  purpose: 'meeting',
  scheduled_at: '2026-11-10 09:00:00',
  scheduled_end: null,
  updated_at: '2026-11-10 10:00:00',
  customer: { code: 'HQC_TEST', erp_cc: 'C8' },
  checkin: {
    time: '2026-11-10 09:15:00',
    photo: 'http://192.168.245.188:3031/uploads/a.jpg',
  },
  checkout: null,
  alerts: [{ type: 'distance', value: 1024 }],
  ...o,
});
const report = (a = appointment()) => ({
  filters: {
    from: null,
    to: null,
    sale: null,
    customer: null,
    sale_id: null,
    customer_id: null,
  },
  total_sales: 1,
  total_appointments: 1,
  data: [
    {
      sale_id: 1369,
      sale_code: '251',
      sale_name: 'Cáp Lê Minh Quân',
      summary: { total: 1 },
      completed: a.status === 'completed' ? [a] : [],
      not_completed: a.status === 'completed' ? [] : [a],
    },
  ],
});
await test('sale 251 resolves to user 57, never source ID 1369', () =>
  assert.deepEqual(policy.resolveAppointmentSale('251', maps, users), {
    userId: 57,
    status: 'matched',
  }));
await test('missing sale code is ignored', () =>
  assert.equal(
    policy.resolveAppointmentSale(null, maps, users).status,
    'ignored',
  ));
await test('duplicate employee code is ambiguous', () =>
  assert.equal(
    policy.resolveAppointmentSale('251', maps, [
      ...users,
      { id: 99, employeeCode: 'NKDS55' },
    ]).status,
    'ambiguous_sale',
  ));
await test('deleted users cannot receive new evidence', () =>
  assert.equal(
    policy.resolveAppointmentSale('251', maps, [
      { ...users[0], deletedAt: new Date() },
    ]).userId,
    null,
  ));
await test('SAP disambiguates identical customer codes', () =>
  assert.equal(
    policy.resolveAppointmentCustomer('hqc_test', 'c8', customers).customerId,
    8,
  ));
await test('missing SAP with duplicate codes is ambiguous', () =>
  assert.equal(
    policy.resolveAppointmentCustomer('HQC_TEST', null, customers).status,
    'ambiguous_customer',
  ));
await test('wrong SAP never falls back to customer code', () =>
  assert.equal(
    policy.resolveAppointmentCustomer('HQC_TEST', 'C999', customers).customerId,
    null,
  ));
await test('unique customer can be matched without SAP', () =>
  assert.equal(
    policy.resolveAppointmentCustomer('HQC_TEST', null, customers.slice(0, 1))
      .customerId,
    8,
  ));
await test('invalid calendar day is rejected', () =>
  assert.throws(() => policy.providerTime('2026-02-30 09:00:00', true)));
await test('time without offset stays Vietnam wall-clock', () =>
  assert.equal(
    policy.providerTime('2026-11-10 00:00:00'),
    '2026-11-10 00:00:00',
  ));
await test('invalid range is rejected', () =>
  assert.throws(() => policy.appointmentRange('2026-11-12', '2026-11-10')));
await test('full report validates', () =>
  assert.equal(policy.validateAppointmentReport(report()).length, 1));
await test('truncated totals reject entire report', () =>
  assert.throws(() =>
    policy.validateAppointmentReport({ ...report(), total_appointments: 2 }),
  ));
await test('filtered reports cannot replace all-source snapshot', () => {
  const r = report();
  r.filters.sale = '251';
  assert.throws(() => policy.validateAppointmentReport(r));
});
await test('duplicates reject entire report', () => {
  const r = report();
  r.data[0].not_completed.push(appointment());
  r.data[0].summary.total++;
  r.total_appointments++;
  assert.throws(() => policy.validateAppointmentReport(r));
});
await test('not_completed checked_in is preserved for web', () =>
  assert.equal(
    policy.validateAppointmentReport(
      report(appointment({ status: 'checked_in' })),
    )[0].appointment.status,
    'checked_in',
  ));

// Transactional in-memory adapter exercises actual sync orchestration, not a copy of it.
let stored = [],
  state = null,
  snapshot,
  lock = true,
  reportValue = report();
const repo = {
  find: async () => structuredClone(stored),
  create: (a) => a,
  save: async (rows) => {
    for (const row of rows) {
      const old = stored.find((a) => a.source_id === row.source_id);
      if (old) Object.assign(old, row);
      else stored.push({ ...row, id: stored.length + 1 });
    }
  },
};
const stateRepo = {
  findOneBy: async () => structuredClone(state),
  save: async (row) => {
    state = { ...state, ...row };
  },
};
const manager = {
  getRepository: (entity) =>
    entity === CustomerAppointment ? repo : stateRepo,
  find: async (entity) =>
    entity === NkmSaleMap
      ? maps
      : entity === User
        ? users
        : entity === Customer
          ? customers
          : [],
};
const runner = {
  manager,
  connect: async () => {},
  release: async () => {},
  query: async (sql) =>
    sql.includes('GET_LOCK') ? [{ acquired: lock ? 1 : 0 }] : [{ released: 1 }],
  startTransaction: async () => {
    snapshot = structuredClone({ stored, state });
  },
  commitTransaction: async () => {},
  rollbackTransaction: async () => {
    stored = snapshot.stored;
    state = snapshot.state;
  },
};
const service = new CustomerAppointmentsService({
  createQueryRunner: () => runner,
  getRepository: () => stateRepo,
});
service.fetchReport = async () => structuredClone(reportValue);
await test('sync persists mapped customer and user', async () => {
  await service.sync();
  assert.equal(stored[0].user_id, 57);
  assert.equal(stored[0].customer_id, 8);
  assert.equal(state.status, 'success');
});
await test('repeat sync is idempotent', async () => {
  await service.sync();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, 1);
});
await test('completed with distance alert still qualifies', () =>
  assert.equal(service.dto(stored[0]).qualifiesAsVisit, true));
await test('DTO replaces LAN image URL with authenticated path', () => {
  const dto = service.dto(stored[0]);
  assert.equal(dto.checkin.photo, '/customer-appointments/1/photos/checkin');
  assert.ok(!('payload' in dto));
});
await test('cancelled correction retracts completion on same record', async () => {
  reportValue = report(
    appointment({ status: 'cancelled', updated_at: '2026-11-10 11:00:00' }),
  );
  await service.sync();
  assert.equal(stored.length, 1);
  assert.equal(service.dto(stored[0]).qualifiesAsVisit, false);
});
await test('partial response preserves previous data and success timestamp', async () => {
  const before = structuredClone(stored);
  const success = state.last_success_at;
  reportValue.total_appointments = 2;
  await assert.rejects(service.sync());
  assert.deepEqual(stored, before);
  assert.equal(state.last_success_at, success);
  assert.equal(state.status, 'error');
});
await test('concurrent invocation cannot acquire lock', async () => {
  lock = false;
  await assert.rejects(service.sync(), /tiến trình/);
  lock = true;
});
await test('unseen record is retained as source_missing', async () => {
  reportValue = {
    filters: report().filters,
    data: [],
    total_sales: 0,
    total_appointments: 0,
  };
  await service.sync();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].mapping_status, 'source_missing');
});
await test('reappearing record restores mapping and completion', async () => {
  reportValue = report(appointment({ updated_at: '2026-11-10 12:00:00' }));
  await service.sync();
  assert.equal(stored[0].mapping_status, 'matched');
  assert.equal(service.dto(stored[0]).qualifiesAsVisit, true);
});
await test('mapping transfer is flagged instead of silently moving evidence', async () => {
  users[0].id = 58;
  await service.sync();
  assert.equal(stored[0].user_id, 57);
  assert.equal(stored[0].mapping_status, 'mapping_conflict');
  users[0].id = 57;
});
await test('null-code sale is outside scope and skipped', async () => {
  reportValue.data[0].sale_code = null;
  const result = await service.sync();
  assert.equal(result.ignored, 1);
  assert.equal(result.total, 0);
});
await test('sale scope is own user', async () =>
  assert.deepEqual(await service.scope({ id: 57, roles: [] }), [57]));
await test('manager without eligible department sees no appointments', async () =>
  assert.deepEqual(
    await service.scope({
      id: 57,
      roles: ['manager-pc'],
      departments: [{ id: 1, server_ip: null }],
    }),
    [],
  ));
await test('pm role alone does not grant company scope', async () =>
  assert.deepEqual(await service.scope({ id: 57, roles: ['pm'] }), [57]));
await test('pm-khach-hang has company scope', async () =>
  assert.equal(
    await service.scope({ id: 57, roles: ['pm-khach-hang'] }),
    undefined,
  ));
await test('foreign sale filter is forbidden', async () =>
  await assert.rejects(
    service.scopedQuery({ id: 57, roles: [] }, 58),
    /quyền/,
  ));

const scoring = new CustomerKpiScoringService();
const definition = {
  key: 'support_khach',
  name: 'Gặp khách',
  metric: 'movement_report',
  scoring_mode: 'binary',
  denominator: null,
  comparison: 'gte',
  target_value: 1,
};
const days = [
  {
    stat_date: '2026-11-10',
    movement_count: 1,
    inbound_count: 0,
    outbound_count: 0,
    revenue: 0,
    order_count: 0,
    zalo_linked: false,
  },
];
await test('visit counts even without Zalo link', () =>
  assert.equal(
    scoring.scoreCustomer(definition, days, 1, '2026-11-10').status,
    'pass',
  ));
await test('incomplete source means no_data not fail for customer', () =>
  assert.equal(
    scoring.scoreCustomer(
      definition,
      [],
      1,
      '2026-11-10',
      null,
      undefined,
      null,
      'Chưa đồng bộ',
    ).status,
    'no_data',
  ));
await test('incomplete source means no_data for sale too', () =>
  assert.equal(
    scoring.scoreSale(
      definition,
      [{ days }],
      1,
      false,
      '2026-11-10',
      undefined,
      null,
      'Chưa đồng bộ',
    ).status,
    'no_data',
  ));
await test('sale formula still binary with customer numerator', () => {
  const r = scoring.scoreSale(
    definition,
    [{ days }, { days: [] }],
    1,
    false,
    '2026-11-10',
  );
  assert.equal(r.actualValue, 1);
  assert.equal(r.numerator, 1);
  assert.equal(r.denominatorValue, 2);
});
await test('same customer code different SAP does not duplicate new visit', () => {
  const reports = Object.create(CustomerKpiReportsService.prototype);
  const activity = new Map();
  reports.mergeMovementReports(
    activity,
    [
      { assignmentId: 1, saleId: 57, customerId: 8, customerCode: 'HQC_TEST' },
      { assignmentId: 2, saleId: 57, customerId: 9, customerCode: 'HQC_TEST' },
    ],
    [
      {
        user_id: 57,
        customer_id: 8,
        customer_code: 'HQC_TEST',
        sent_at: '2026-11-10 09:15:00',
      },
    ],
  );
  assert.equal(activity.get(1)[0].movement_count, 1);
  assert.equal(activity.has(2), false);
});
await test('legacy message without resolved customer ID is never visit evidence', () => {
  const reports = Object.create(CustomerKpiReportsService.prototype);
  const activity = new Map();
  reports.mergeMovementReports(
    activity,
    [{ assignmentId: 1, saleId: 57, customerId: 8, customerCode: 'HQC_TEST' }],
    [
      {
        user_id: 57,
        customer_code: 'HQC_TEST',
        sent_at: '2026-11-09 09:00:00',
      },
    ],
  );
  assert.equal(activity.size, 0);
});
await test('fresh ISO timestamp is not stale regardless of local timezone', async () => {
  state.last_success_at = new Date().toISOString();
  assert.equal((await service.syncStatus()).stale, false);
});
await test('expired timestamp marks the source stale', async () => {
  state.last_success_at = new Date(Date.now() - 16 * 60000).toISOString();
  assert.equal((await service.syncStatus()).stale, true);
});
await test('source older version cannot overwrite a newer stored appointment', async () => {
  reportValue = report(appointment({ updated_at: '2026-11-09 12:00:00' }));
  const before = structuredClone(stored);
  await assert.rejects(service.sync());
  assert.deepEqual(stored, before);
});
await test('checkin alone and missing checkin never qualify', () => {
  const a = { ...stored[0], mapping_status: 'matched', status: 'checked_in' };
  assert.equal(service.dto(a).qualifiesAsVisit, false);
  assert.equal(
    service.dto({ ...a, status: 'completed', checkin_at: null })
      .qualifiesAsVisit,
    false,
  );
});
await test('historical completed appointment qualifies regardless of deployment date', () => {
  assert.equal(
    service.dto({
      ...stored[0],
      mapping_status: 'matched',
      status: 'completed',
      checkin_at: '2026-10-15 09:00:00',
    }).qualifiesAsVisit,
    true,
  );
});
await test('date of actual checkin determines visit eligibility', () => {
  assert.equal(
    service.dto({
      ...stored[0],
      mapping_status: 'matched',
      status: 'completed',
      scheduled_at: '2026-11-09 23:00:00',
      checkin_at: '2026-11-10 00:01:00',
    }).qualifiesAsVisit,
    true,
  );
});
await test('whole-quarter query uses checkin without clipping history and includes last day', async () => {
  const reports = Object.create(CustomerKpiReportsService.prototype);
  const bindings = [];
  const qb = (name) => {
    const q = {
      select: () => q,
      addSelect: () => q,
      where: (sql, p) => {
        bindings.push({ name, sql, p });
        return q;
      },
      andWhere: (sql, p) => {
        bindings.push({ name, sql, p });
        return q;
      },
      getRawMany: async () => [],
    };
    return q;
  };
  reports.movementRepo = { createQueryBuilder: () => qb('archive') };
  reports.appointmentRepo = { createQueryBuilder: () => qb('api') };
  await reports.loadMovementEvents([57], '2026-10-01', '2026-12-31');
  assert.ok(!bindings.some((b) => b.name === 'archive'));
  assert.ok(
    bindings.some(
      (b) =>
        b.name === 'api' &&
        b.p?.from === '2026-10-01 00:00:00' &&
        b.p?.until === '2027-01-01 00:00:00',
    ),
  );
  assert.ok(
    bindings.some((b) => b.name === 'api' && b.sql.includes('a.checkin_at')),
  );
});
await test('historical range never reads legacy message evidence', async () => {
  const reports = Object.create(CustomerKpiReportsService.prototype);
  reports.movementRepo = {
    createQueryBuilder: () => {
      throw new Error('Legacy must not be read');
    },
  };
  const q = {
    select: () => q,
    addSelect: () => q,
    where: () => q,
    andWhere: () => q,
    getRawMany: async () => [],
  };
  reports.appointmentRepo = { createQueryBuilder: () => q };
  await reports.loadMovementEvents([57], '2026-10-01', '2026-10-31');
});
await test('provider null customer code is valid data, not a broken response', () => {
  assert.equal(
    policy.validateAppointmentReport(
      report(appointment({ customer: { code: null, erp_cc: null } })),
    ).length,
    1,
  );
  assert.equal(
    policy.resolveAppointmentCustomer(null, null, customers).status,
    'unmatched_customer',
  );
});
await test('null customer code syncs under sale without attributing a customer', async () => {
  reportValue = report(
    appointment({
      updated_at: '2026-11-10 13:00:00',
      customer: { code: null, erp_cc: null, name: 'Khách chưa có mã' },
    }),
  );
  await service.sync();
  assert.equal(stored[0].user_id, 57);
  assert.equal(stored[0].customer_id, null);
  assert.equal(stored[0].mapping_status, 'unmatched_customer');
  assert.equal(service.dto(stored[0]).qualifiesAsVisit, false);
});
await test('unidentified completed visit cannot make customers fail unfairly', async () => {
  const qb = { where: () => qb, getMany: async () => [stored[0]] };
  const health = new CustomerAppointmentsService({
    getRepository: (entity) =>
      entity === CustomerAppointmentSyncState
        ? stateRepo
        : entity === NkmSaleMap
          ? { find: async () => maps }
          : entity === User
            ? { find: async () => users }
            : { createQueryBuilder: () => qb },
  });
  const reasons = await health.unavailableReasons(
    [{ assignmentId: 1, saleId: 57, customerId: 8, customerCode: 'HQC_TEST' }],
    '2026-11-10',
    '2026-11-10',
  );
  assert.ok(reasons.get(1)?.includes('đối chiếu'));
});
await test('cross-origin provider photo is never fetched', async () => {
  const photos = new CustomerAppointmentsService({});
  photos.find = async () => ({
    payload: { checkin: { photo: 'https://example.com/uploads/a.jpg' } },
  });
  await assert.rejects(photos.photo(1, 'checkin', { id: 57 }), /không hợp lệ/);
});
await test('quarter TC3 passes for an October visit even when integration starts in November', () => {
  const historicalDays = [{ ...days[0], stat_date: '2026-10-15' }];
  assert.equal(scoring.scoreCustomer(definition, historicalDays, 1, '2026-10-01').status, 'pass');
  const sale = scoring.scoreSale(definition, [{ days: historicalDays }], 1, false, '2026-10-01');
  assert.equal(sale.status, 'pass');
  assert.equal(sale.numerator, 1);
});
console.log(`${passed} appointment regression tests passed`);
