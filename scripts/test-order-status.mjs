import assert from 'node:assert/strict';
import {
  assertStatusTransition,
  normalizeOrderStatus,
  normalizeStatusCsv,
} from '../dist/order-details/order-status.constants.js';

assert.equal(normalizeOrderStatus('pending'), 'quoted');
assert.equal(normalizeOrderStatus('confirmed'), 'completed');
assert.equal(normalizeOrderStatus('cared'), 'cared');
assert.equal(normalizeOrderStatus('rejected'), 'rejected');

assert.deepEqual(normalizeStatusCsv('pending,confirmed,cared,foo'), [
  'quoted',
  'completed',
  'cared',
]);

assert.equal(assertStatusTransition('quoted', 'completed'), 'completed');
assert.equal(assertStatusTransition('quoted', 'rejected'), 'rejected');
assert.equal(
  assertStatusTransition('quoted', 'cared', { allowCared: true }),
  'cared',
);
assert.throws(
  () => assertStatusTransition('quoted', 'cared', { allowCared: false }),
  /Đã thăm hỏi/,
);
assert.throws(
  () => assertStatusTransition('cared', 'quoted'),
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

process.env.ORDER_STATUS_STRICT = 'false';
assert.equal(assertStatusTransition('completed', 'quoted'), 'quoted');
delete process.env.ORDER_STATUS_STRICT;

console.log('✅ order-status constants OK');
