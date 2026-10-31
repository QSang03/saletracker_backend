import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from '../users/user.entity';

/**
 * Danh sách người được admin chỉ định được NẠP file Excel thời gian bảo hành.
 *
 * Mặc định chỉ role admin nạp được (`POST /products/import-warranty`). Admin
 * muốn giao cho một trưởng phòng/manager cụ thể thì thêm user đó vào đây —
 * cho phép chỉ định TỪNG NGƯỜI, không gắn theo role.
 */
@Entity('product_warranty_importers')
@Unique('uq_pwi_user_id', ['userId'])
export class ProductWarrantyImporter {
  @PrimaryGeneratedColumn()
  id: number;

  /** User được chỉ định — xoá user thì dòng này tự dọn (CASCADE). */
  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  /** Id của admin đã chỉ định (null nếu không xác định). */
  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
