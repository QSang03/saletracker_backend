import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { SaleExcelCatalog } from './sale-excel-catalog.entity';
import { SaleExcelSheet } from './sale-excel-sheet.entity';
import { Product } from '../../products/product.entity';

@Entity('sale_excel_items')
export class SaleExcelItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('idx_sei_catalog')
  @Column({ name: 'catalog_id', type: 'int' })
  catalogId: number;

  @ManyToOne(() => SaleExcelCatalog, (catalog) => catalog.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'catalog_id' })
  catalog: SaleExcelCatalog;

  @Index('idx_sei_sheet')
  @Column({ name: 'sheet_id', type: 'int' })
  sheetId: number;

  @ManyToOne(() => SaleExcelSheet, (sheet) => sheet.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sheet_id' })
  sheet: SaleExcelSheet;

  @Column({ name: 'row_index', type: 'int', default: 0 })
  rowIndex: number;

  @Index('idx_sei_code')
  @Column({ name: 'product_code', type: 'varchar', length: 255 })
  productCode: string;

  @Column({ name: 'product_name', type: 'text' })
  productName: string;

  @Column({ name: 'model_name', type: 'varchar', length: 255, nullable: true })
  modelName?: string | null;

  @Column({ name: 'warranty', type: 'varchar', length: 100, nullable: true })
  warranty?: string | null;

  @Column({
    name: 'price',
    type: 'bigint',
    default: 0,
    transformer: {
      to: (value?: number | null) => value ?? 0,
      from: (value?: string | number | null) =>
        value === null || value === undefined ? 0 : Number(value),
    },
  })
  price: number;

  @Column({ name: 'raw_status', type: 'text', nullable: true })
  rawStatus?: string | null;

  // So khớp với Kho S1
  @Index('idx_sei_matched')
  @Column({ name: 's1_matched', type: 'boolean', default: false })
  s1Matched: boolean;

  @Column({ name: 's1_product_id', type: 'int', nullable: true })
  s1ProductId?: number | null;

  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 's1_product_id' })
  s1Product?: Product | null;

  @Column({ name: 's1_stock_quantity', type: 'int', nullable: true })
  s1StockQuantity?: number | null;

  @Column({ name: 'is_custom', type: 'boolean', default: true })
  isCustom: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
