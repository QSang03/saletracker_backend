import { Injectable } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Notification } from './notification.entity';

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
  ) {}

  async findAllByUser(userId: number) {
    return this.notificationRepo.find({
      where: { user: { id: userId } },
      order: { created_at: 'DESC' },
    });
  }

  async markAsRead(id: number, userId: number) {
    const noti = await this.notificationRepo.findOne({ where: { id, user: { id: userId } } });
    if (!noti) return null;
    noti.is_read = 1;
    return this.notificationRepo.save(noti);
  }

  async markManyAsRead(ids: number[], userId: number) {
    await this.notificationRepo.update({ id: In(ids), user: { id: userId } }, { is_read: 1 });
    return this.findAllByUser(userId);
  }

  async delete(id: number, userId: number) {
    return this.notificationRepo.softDelete({ id, user: { id: userId } });
  }

  async deleteAll(userId: number) {
    const notis = await this.notificationRepo.find({ where: { user: { id: userId } } });
    const ids = notis.map(n => n.id);
    if (ids.length === 0) return { affected: 0 };
    return this.notificationRepo.softDelete(ids);
  }
}
