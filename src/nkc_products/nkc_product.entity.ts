import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity({ name: 'nkc_products' })
export class NKCProduct {
  @PrimaryColumn({ type: 'int' })
  id: number;

  @Column({ name: 'product_code', type: 'varchar', length: 255 })
  productCode: string;

  @Column({ name: 'product_name', type: 'varchar', length: 255 })
  productName: string;

  @Column({ type: 'json', nullable: true })
  properties: any;

  @Column({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt?: Date;
}
