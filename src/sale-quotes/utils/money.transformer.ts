import { ValueTransformer } from 'typeorm';

/**
 * MySQL BIGINT trả về string (bigNumberStrings: true trong typeorm.config).
 * Transformer này giữ API trả về number cho FE, giống Product.price.
 *
 * `to` phải giữ nguyên `undefined` (không đổi thành null): TypeORM chỉ dùng
 * DEFAULT của cột khi giá trị là undefined, còn null sẽ được bind thẳng vào
 * câu INSERT và làm fail các cột NOT NULL DEFAULT 0 (vd. total_amount).
 */
export const bigintTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | number | null) =>
    value === null || value === undefined ? null : Number(value),
};
