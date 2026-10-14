import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Bảng tra mã nhóm hàng (grpId) của NKM.
 *
 * Lead cấp thêm tham số `grpId` cho API doanh thu nhưng chưa chốt dùng vào KPI
 * thế nào (phỏng đoán: xác nhận khách mua hàng thuộc ngành hàng nào). Bảng tra
 * được lưu sẵn để khi chốt chỉ việc bật cấu hình `nkm.sync_grp_id`, không phải
 * sửa code — nguồn là sheet `Nhom Hang Key None` của file bảng tra mã.
 */
@Entity('nkm_group_map')
export class NkmGroupMap {
  @PrimaryGeneratedColumn()
  id: number;

  /** `grpId` trong API NKM, ví dụ 127 = NOTEBOOK, 120 = MÁY IN. */
  @Column({ type: 'int', unique: true })
  grp_id: number;

  @Column({ type: 'varchar', length: 128 })
  group_name: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
