import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity('debt_import_backups')
export class DebtImportBackup {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 100 })
  import_session_id: string; // UUID để nhóm các backup trong 1 lần import

  @Column({ type: 'int' })
  original_debt_id: number;

  @Column({ type: 'json' })
  original_data: any; // Lưu toàn bộ data gốc

  @Column({ type: 'varchar', length: 50 })
  action_type: string; // 'UPDATE', 'CREATE', 'MARK_PAID'

  @CreateDateColumn()
  created_at: Date;
}