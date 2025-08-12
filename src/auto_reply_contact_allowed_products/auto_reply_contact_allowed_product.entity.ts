import { Entity, PrimaryColumn, ManyToOne, JoinColumn, Column } from 'typeorm';
import { AutoReplyContact } from '../auto_reply_contacts/auto_reply_contact.entity';
import { AutoReplyProduct } from '../auto_reply_products/auto_reply_product.entity';

@Entity('auto_reply_contact_allowed_products')
export class AutoReplyContactAllowedProduct {
  @PrimaryColumn({ name: 'contact_id', type: 'int' })
  contactId: number;

  @PrimaryColumn({ name: 'product_id', type: 'int' })
  productId: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @ManyToOne(() => AutoReplyContact, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_id', referencedColumnName: 'contactId' })
  contact: AutoReplyContact;

  @ManyToOne(() => AutoReplyProduct, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id', referencedColumnName: 'productId' })
  product: AutoReplyProduct;
}
