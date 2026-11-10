import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Local mirror of the appointment provider. IDs are NEVER users.id. */
@Entity('customer_appointments')
@Index('uq_customer_appointment_source', ['source_id'], { unique: true })
@Index('idx_customer_appointment_kpi', ['user_id', 'customer_id', 'checkin_at'])
@Index('idx_customer_appointment_schedule', ['user_id', 'scheduled_at'])
export class CustomerAppointment {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int' }) source_id: number;
  @Column({ type: 'int' }) source_sale_id: number;
  @Column({ type: 'varchar', length: 32 }) source_sale_code: string;
  @Column({ type: 'varchar', length: 255 }) sale_name: string;
  @Column({ type: 'int', nullable: true }) user_id: number | null;
  @Column({ type: 'int', nullable: true }) customer_id: number | null;
  @Column({ type: 'varchar', length: 64 }) customer_code: string;
  @Column({ type: 'varchar', length: 32 }) sap_code: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) customer_name:
    string | null;
  @Column({ type: 'varchar', length: 64 }) appointment_code: string;
  @Column({ type: 'varchar', length: 512 }) title: string;
  @Column({ type: 'varchar', length: 32 }) status: string;
  @Column({ type: 'varchar', length: 32 }) purpose: string;
  // Wall-clock values from provider, explicitly interpreted as Vietnam time.
  @Column({ type: 'varchar', length: 19 }) scheduled_at: string;
  @Column({ type: 'varchar', length: 19, nullable: true }) scheduled_end:
    string | null;
  @Column({ type: 'varchar', length: 19, nullable: true }) checkin_at:
    string | null;
  @Column({ type: 'varchar', length: 19, nullable: true }) checkout_at:
    string | null;
  @Column({ type: 'varchar', length: 19 }) source_updated_at: string;
  @Column({ type: 'varchar', length: 32 }) mapping_status: string;
  @Column({ type: 'json' }) payload: Record<string, any>;
  @Column({ type: 'varchar', length: 24 }) synced_at: string;
}

@Entity('customer_appointment_sync_state')
export class CustomerAppointmentSyncState {
  @PrimaryColumn({ type: 'int' }) id: number;
  @Column({ type: 'varchar', length: 24, nullable: true }) last_success_at:
    string | null;
  @Column({ type: 'varchar', length: 24, nullable: true }) last_attempt_at:
    string | null;
  @Column({ type: 'varchar', length: 32 }) status: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) error:
    string | null;
  @Column({ type: 'int', default: 0 }) total: number;
  @Column({ type: 'int', default: 0 }) ignored: number;
}
