import assert from 'node:assert/strict';
import {
  assertStatusTransition,
  isCareEligibleStatus,
  normalizeOrderStatus,
  normalizeStatusCsv,
} from '../dist/order-details/order-status.constants.js';

assert.equal(normalizeOrderStatus('pending'), 'quoted');
assert.equal(normalizeOrderStatus('confirmed'), 'completed');
assert.equal(normalizeOrderStatus('cared'), 'cared');
assert.equal(normalizeOrderStatus('demand_cared'), 'demand_cared');
assert.equal(normalizeOrderStatus('rejected'), 'rejected');

assert.deepEqual(
  normalizeStatusCsv('pending,confirmed,cared,demand_cared,foo'),
  ['quoted', 'completed', 'cared', 'demand_cared'],
);

for (const status of ['quoted', 'cared', 'demand', 'demand_cared']) {
  assert.equal(isCareEligibleStatus(status), true, `${status} phải care được`);
}
for (const status of ['completed', 'rejected']) {
  assert.equal(
    isCareEligibleStatus(status),
    false,
    `${status} không care được`,
  );
}

assert.equal(assertStatusTransition('quoted', 'completed'), 'completed');
assert.equal(assertStatusTransition('quoted', 'rejected'), 'rejected');
assert.equal(
  assertStatusTransition('quoted', 'cared', { allowCared: true }),
  'cared',
);
assert.equal(
  assertStatusTransition('demand', 'demand_cared', { allowCared: true }),
  'demand_cared',
);
assert.equal(
  assertStatusTransition('demand_cared', 'demand_cared', { allowCared: true }),
  'demand_cared',
);
assert.throws(
  () => assertStatusTransition('quoted', 'cared', { allowCared: false }),
  /Đã thăm hỏi/,
);
assert.throws(
  () => assertStatusTransition('demand', 'demand_cared', { allowCared: false }),
  /Đã thăm hỏi nhu cầu/,
);
assert.throws(
  () => assertStatusTransition('cared', 'quoted'),
  /Không thể chuyển trạng thái/,
);
assert.throws(
  () => assertStatusTransition('cared', 'demand'),
  /Không thể chuyển trạng thái/,
);
assert.throws(
  () => assertStatusTransition('completed', 'quoted'),
  /Không thể chuyển trạng thái/,
);
assert.throws(
  () => assertStatusTransition('demand', 'completed'),
  /Không thể chuyển trạng thái/,
);
assert.throws(
  () => assertStatusTransition('demand_cared', 'completed'),
  /Không thể chuyển trạng thái/,
);

process.env.ORDER_STATUS_STRICT = 'false';
assert.equal(assertStatusTransition('completed', 'quoted'), 'quoted');
// Status do care service gán vẫn bị chặn dù tắt strict.
assert.throws(
  () => assertStatusTransition('demand', 'demand_cared'),
  /Đã thăm hỏi nhu cầu/,
);
delete process.env.ORDER_STATUS_STRICT;

console.log('✅ order-status constants OK');
