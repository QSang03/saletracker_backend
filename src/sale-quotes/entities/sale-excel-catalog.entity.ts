import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { SaleExcelSheet } from './sale-excel-sheet.entity';
import { SaleExcelItem } from './sale-excel-item.entity';

@Entity('sale_excel_catalogs')
export class SaleExcelCatalog {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('idx_sec_name')
  @Column({ name: 'name', type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'original_file_name', type: 'varchar', length: 255 })
  originalFileName: string;

  @Column({ name: 'file_path', type: 'varchar', length: 500, nullable: true })
  filePath?: string | null;

  @Column({ name: 'file_size', type: 'bigint', default: 0 })
  fileSize: number;

  @Index('idx_sec_template')
  @Column({ name: 'template_type', type: 'tinyint', default: 1 })
  templateType: number; // 1: ASUS NUC-LCD, 2: ASUS Quy Dinh, 3: PC MSI, 4: Silicon-Nikatei-FujiE

  @Column({ name: 'total_sheets', type: 'int', default: 0 })
  totalSheets: number;

  @Column({ name: 'total_items', type: 'int', default: 0 })
  totalItems: number;

  @Column({ name: 'created_by_user_id', type: 'int', nullable: true })
  createdByUserId?: number | null;

  @Column({ name: 'updated_by_user_id', type: 'int', nullable: true })
  updatedByUserId?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => SaleExcelSheet, (sheet) => sheet.catalog, { cascade: true })
  sheets: SaleExcelSheet[];

  @OneToMany(() => SaleExcelItem, (item) => item.catalog, { cascade: true })
  items: SaleExcelItem[];
}
