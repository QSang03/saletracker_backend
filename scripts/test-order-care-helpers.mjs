import assert from 'node:assert/strict';
import { OrderCareService } from '../dist/order-care/order-care.service.js';

const service = new OrderCareService({}, {}, {}, {}, {}, {}, {}, {});

const multiProduct = {
  id: 1,
  order_id: 10,
  zaloMessageId: '123_product_2',
  metadata: {
    trigger_message_id: '123',
    customer_id: 'cust-1',
    conversation_info: { is_group: false, conversation_name: 'Khách A' },
    messages: [{ message_id: '123', content: 'Cần 2 sản phẩm' }],
  },
};

assert.equal(service.resolveSourceMessageId(multiProduct), '123');
const info = service.resolveCustomerInfo(multiProduct, '123');
assert.equal(info.customerId, 'cust-1');
assert.equal(info.customerType, 'private');
assert.equal(info.sourceContent, 'Cần 2 sản phẩm');
assert.equal(info.customerName, 'Khách A');

const fallback = {
  id: 2,
  zaloMessageId: '999_product_1',
  metadata: null,
};
assert.equal(service.resolveSourceMessageId(fallback), '999');
assert.equal(service.resolveCustomerInfo(fallback, '999'), null);

const summary = service.toOrderSummary({
  id: 3,
  order_id: 30,
  raw_item: 'SP',
  quantity: 2,
  unit_price: 1000,
  status: 'quoted',
  care_count: 1,
  customer_name: 'Khách B',
  is_project: true,
});
assert.deepEqual(summary, {
  id: 3,
  order_id: 30,
  raw_item: 'SP',
  quantity: 2,
  unit_price: 1000,
  status: 'quoted',
  care_count: 1,
  customer_name: 'Khách B',
  is_project: true,
});

console.log('✅ order-care source/customer grouping helpers OK');
