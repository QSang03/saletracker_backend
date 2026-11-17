import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { SaleExcelCatalog } from './sale-excel-catalog.entity';
import { SaleExcelItem } from './sale-excel-item.entity';

@Entity('sale_excel_sheets')
export class SaleExcelSheet {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('idx_ses_catalog')
  @Column({ name: 'catalog_id', type: 'int' })
  catalogId: number;

  @ManyToOne(() => SaleExcelCatalog, (catalog) => catalog.sheets, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'catalog_id' })
  catalog: SaleExcelCatalog;

  @Column({ name: 'sheet_name', type: 'varchar', length: 255 })
  sheetName: string;

  @Column({ name: 'sheet_index', type: 'int', default: 0 })
  sheetIndex: number;

  @Column({ name: 'item_count', type: 'int', default: 0 })
  itemCount: number;

  @Column({ name: 'excel_columns', type: 'json', nullable: true })
  excelColumns?: string[] | null;

  @Column({ name: 'mapped_columns', type: 'json', nullable: true })
  mappedColumns?: string[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => SaleExcelItem, (item) => item.sheet, { cascade: true })
  items: SaleExcelItem[];
}
