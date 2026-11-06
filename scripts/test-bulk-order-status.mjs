import assert from 'node:assert/strict';
import { planBulkStatusTransition } from '../dist/order-details/bulk-status.helper.js';

// quoted/cared -> completed được; completed là no-op; demand/rejected bị chặn.
let plan = planBulkStatusTransition(
  [
    { id: 1, status: 'quoted' },
    { id: 2, status: 'cared' },
    { id: 3, status: 'completed' },
    { id: 4, status: 'demand' },
    { id: 5, status: 'rejected' },
    { id: 6, status: 'quoted' },
  ],
  'completed',
);

assert.equal(plan.toStatus, 'completed');
assert.deepEqual(
  plan.updatable.map((item) => item.id).sort((a, b) => a - b),
  [1, 2, 6],
);
assert.deepEqual(plan.unchangedIds, [3]);
assert.deepEqual(
  plan.skipped.map((item) => item.id).sort((a, b) => a - b),
  [4, 5],
);
assert.ok(plan.skipped.every((item) => item.code === 'invalid_transition'));

// quoted -> demand được; cared -> demand bị chặn.
plan = planBulkStatusTransition(
  [
    { id: 1, status: 'quoted' },
    { id: 2, status: 'cared' },
  ],
  'demand',
);
assert.deepEqual(
  plan.updatable.map((item) => item.id),
  [1],
);
assert.deepEqual(
  plan.skipped.map((item) => item.id),
  [2],
);

// quoted/cared -> rejected được; demand/completed/rejected bị chặn.
plan = planBulkStatusTransition(
  [
    { id: 1, status: 'quoted' },
    { id: 2, status: 'cared' },
    { id: 3, status: 'demand' },
    { id: 4, status: 'completed' },
    { id: 5, status: 'rejected' },
  ],
  'rejected',
);
assert.deepEqual(
  plan.updatable.map((item) => item.id),
  [1, 2],
);
assert.deepEqual(plan.unchangedIds, [5]);
assert.deepEqual(
  plan.skipped.map((item) => item.id),
  [3, 4],
);

// Legacy pending được normalize khi check transition nhưng WHERE vẫn dùng giá trị DB.
plan = planBulkStatusTransition([{ id: 9, status: 'pending' }], 'completed');
assert.equal(plan.updatable[0].fromStatus, 'quoted');
assert.equal(plan.updatable[0].dbStatus, 'pending');

// Target care-only hoặc quoted bị chặn cho cả request, kể cả khi rows rỗng.
for (const target of ['cared', 'demand_cared']) {
  assert.throws(
    () => planBulkStatusTransition([], target),
    /chỉ được gán qua chức năng Chăm sóc/,
    `${target} phải bị chặn`,
  );
}
for (const target of ['quoted', 'pending']) {
  assert.throws(
    () => planBulkStatusTransition([], target),
    /Trạng thái đích không hợp lệ/,
    `${target} không phải target bulk hợp lệ`,
  );
}

// Status hiện tại lạ (dữ liệu bẩn) -> skip từng dòng, không làm sập batch.
plan = planBulkStatusTransition([{ id: 7, status: 'weird' }], 'completed');
assert.equal(plan.skipped.length, 1);
assert.equal(plan.skipped[0].code, 'invalid_transition');

// Target không tồn tại -> 400.
assert.throws(
  () => planBulkStatusTransition([], 'bogus'),
  /Trạng thái đơn hàng không hợp lệ/,
);

console.log('✅ bulk order status planner OK');
