import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
} from 'typeorm';
import { AutoReplyContact } from '../auto_reply_contacts/auto_reply_contact.entity';
import { AutoReplyRouteProduct } from 'src/auto_reply_products/auto_reply_route_product.entity';

@Entity('auto_reply_keyword_routes')
@Unique('unique_keyword_contact', ['keyword', 'contactId'])
export class AutoReplyKeywordRoute {
  @PrimaryGeneratedColumn({ name: 'route_id' })
  routeId: number;

  @Column({ type: 'varchar', length: 255 })
  keyword: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @OneToMany(() => AutoReplyRouteProduct, (rp) => rp.route, { cascade: ['insert','update'] })
  routeProducts: AutoReplyRouteProduct[];

  @Column({ type: 'int', name: 'contact_id' })
  contactId: number;

  @ManyToOne(() => AutoReplyContact, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_id', referencedColumnName: 'contactId' })
  contact: AutoReplyContact;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
