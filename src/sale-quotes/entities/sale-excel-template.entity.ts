import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export interface SheetGroupMapping {
  groupId: string;
  groupName: string;
  appliedSheets: string[]; // Danh sách tên các tab áp dụng
  headerRow: number; // Dòng chứa header (mặc định 1 hoặc 2)
  dataStartRow: number; // Dòng bắt đầu đọc dữ liệu (vd: header dòng 2 thì data dòng 3)
  columns: {
    productCode: string; // Tên cột trong Excel dùng làm Mã SP (Bắt buộc)
    productName: string; // Tên cột trong Excel dùng làm Tên SP (Bắt buộc - Cột 1)
    productName2?: string; // Tên cột thứ 2 nối tiếp vào Tên SP (Tùy chọn)
    modelName?: string;
    warranty?: string;
    price?: string;
    rawStatus?: string;
  };
  excelColumns: string[]; // Toàn bộ cột trong file Excel để xem trước & render file mẫu
}

@Entity('sale_excel_templates')
export class SaleExcelTemplate {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'json' })
  sheetGroups: SheetGroupMapping[];

  @Column({ type: 'int', nullable: true })
  createdById: number | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;
}
