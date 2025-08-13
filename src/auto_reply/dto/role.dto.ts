import { IsEnum } from 'class-validator';
import { ContactRole } from '../../auto_reply_contacts/auto_reply_contact.entity';

export class UpdateRoleDto {
  @IsEnum(ContactRole)
  role: ContactRole;
}
