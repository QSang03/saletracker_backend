import { ValueTransformer } from 'typeorm';

/**
 * MySQL BIGINT trả về string (bigNumberStrings: true trong typeorm.config).
 * Transformer này giữ API trả về number cho FE, giống Product.price.
 */
export const bigintTransformer: ValueTransformer = {
  to: (value?: number | null) => value ?? null,
  from: (value?: string | number | null) =>
    value === null || value === undefined ? null : Number(value),
};
