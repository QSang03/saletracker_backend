import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { createHash } from 'crypto';
import {
  OrderDetail,
  OrderDetailStatus,
} from '../order-details/order-detail.entity';
import {
  isCareEligibleStatus,
  normalizeOrderStatus,
} from '../order-details/order-status.constants';
import { OrderStatusContextService } from '../order-details/order-status-context.service';
import { OrderService } from '../orders/order.service';
import { ZaloPythonApiClient } from '../customer-kpi/zalo-python-api.client';
import {
  OrderCareBatch,
  OrderCareBatchStatus,
  OrderCareCustomerType,
} from './entities/order-care-batch.entity';
import { OrderCareItem } from './entities/order-care-item.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import {
  CareHistoryQueryDto,
  CarePreviewDto,
  CareSendDto,
} from './dto/order-care.dto';

export interface CareOrderSummary {
  id: number;
  order_id: number;
  raw_item: string | null;
  quantity: number;
  unit_price: number;
  status: string;
  care_count: number;
  customer_name: string | null;
  is_project: boolean;
}

export interface CareGroupPlan {
  key: string;
  source_message_id: string;
  zalo_customer_id: string;
  customer_type: OrderCareCustomerType;
  customer_name: string | null;
  source_message_content: string | null;
  selected_order_ids: number[];
  expanded_order_ids: number[];
  all_order_ids: number[];
  orders: CareOrderSummary[];
}

export interface CareGroupResult {
  batch_id: number | null;
  source_message_id: string;
  zalo_customer_id: string;
  customer_type: OrderCareCustomerType;
  status: 'sent' | 'failed' | 'in_progress' | 'record_failed';
  order_ids: number[];
  added_order_ids: number[];
  skipped_order_ids: number[];
  care_count: number;
  sent_at?: string;
  error?: string;
}

@Injectable()
export class OrderCareService {
  private readonly logger = new Logger(OrderCareService.name);

  constructor(
    @InjectRepository(OrderDetail)
    private readonly orderDetailRepository: Repository<OrderDetail>,
    @InjectRepository(OrderCareBatch)
    private readonly careBatchRepository: Repository<OrderCareBatch>,
    @InjectRepository(OrderCareItem)
    private readonly careItemRepository: Repository<OrderCareItem>,
    @InjectRepository(OrderStatusHistory)
    private readonly statusHistoryRepository: Repository<OrderStatusHistory>,
    private readonly orderStatusContextService: OrderStatusContextService,
    private readonly orderService: OrderService,
    private readonly pythonApi: ZaloPythonApiClient,
  ) {}

  async preview(user: any, dto: CarePreviewDto) {
    const selected = await this.loadSelectedDetails(
      dto.order_ids,
      user,
      !!dto.include_hidden,
    );
    const selectedMap = new Map(selected.map((item) => [Number(item.id), item]));
    const skipped: { order_id: number; reason: string }[] = [];
    const groups = new Map<string, CareGroupPlan>();

    for (const orderId of dto.order_ids) {
      const detail = selectedMap.get(Number(orderId));
      if (!detail) {
        skipped.push({
          order_id: Number(orderId),
          reason: 'not_found_or_forbidden',
        });
        continue;
      }

      if (!isCareEligibleStatus(detail.status)) {
        skipped.push({
          order_id: Number(orderId),
          reason: 'status_not_eligible',
        });
        continue;
      }

      const sourceMessageId = this.resolveSourceMessageId(detail);
      if (!sourceMessageId) {
        skipped.push({
          order_id: Number(orderId),
          reason: 'missing_source_message',
        });
        continue;
      }

      const customer = this.resolveCustomerInfo(detail, sourceMessageId);
      if (!customer) {
        skipped.push({
          order_id: Number(orderId),
          reason: 'missing_customer_info',
        });
        continue;
      }

      const saleId = detail.order?.sale_by?.id;
      const key = `${saleId}:${customer.customerId}:${sourceMessageId}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          source_message_id: sourceMessageId,
          zalo_customer_id: customer.customerId,
          customer_type: customer.customerType,
          customer_name: customer.customerName,
          source_message_content: customer.sourceContent,
          selected_order_ids: [],
          expanded_order_ids: [],
          all_order_ids: [],
          orders: [],
        });
      }
      const group = groups.get(key)!;
      if (!group.selected_order_ids.includes(Number(orderId))) {
        group.selected_order_ids.push(Number(orderId));
      }
    }

    for (const group of groups.values()) {
      const siblings = await this.loadSiblings(
        user,
        group.source_message_id,
        !!dto.include_hidden,
      );

      const eligibleSiblings = siblings.filter((detail) => {
        if (!isCareEligibleStatus(detail.status)) return false;
        const siblingCustomer = this.resolveCustomerInfo(
          detail,
          group.source_message_id,
        );
        return (
          !!siblingCustomer &&
          siblingCustomer.customerId === group.zalo_customer_id
        );
      });

      const allIds = new Set<number>(group.selected_order_ids);
      for (const sibling of eligibleSiblings) {
        allIds.add(Number(sibling.id));
      }

      group.all_order_ids = Array.from(allIds);
      group.expanded_order_ids = group.all_order_ids.filter(
        (id) => !group.selected_order_ids.includes(id),
      );
      group.orders = [...group.selected_order_ids, ...group.expanded_order_ids]
        .map((id) =>
          siblings.find((item) => Number(item.id) === id) ||
          selectedMap.get(id),
        )
        .filter((item): item is OrderDetail => !!item)
        .map((item) => this.toOrderSummary(item));
    }

    return {
      groups: Array.from(groups.values()),
      skipped,
      totals: {
        selected: dto.order_ids.length,
        eligible: Array.from(groups.values()).reduce(
          (sum, group) => sum + group.selected_order_ids.length,
          0,
        ),
        expanded: Array.from(groups.values()).reduce(
          (sum, group) => sum + group.expanded_order_ids.length,
          0,
        ),
        affected: Array.from(groups.values()).reduce(
          (sum, group) => sum + group.all_order_ids.length,
          0,
        ),
        skipped: skipped.length,
        groups: groups.size,
      },
    };
  }

  async care(user: any, dto: CareSendDto) {
    const content = (dto.message_content || '').trim();
    if (!content) {
      throw new BadRequestException('Nội dung chăm sóc không được để trống');
    }

    const preview = await this.preview(user, dto);
    if (preview.groups.length === 0) {
      throw new BadRequestException(
        preview.skipped.length > 0
          ? `Không có đơn hợp lệ để chăm sóc (${preview.skipped
              .map((item) => item.reason)
              .join(', ')})`
          : 'Không có đơn hợp lệ để chăm sóc',
      );
    }

    if (preview.groups.length > 20) {
      throw new BadRequestException(
        'Mỗi lần chăm sóc tối đa 20 nhóm tin nhắn; vui lòng chia nhỏ lựa chọn',
      );
    }

    const results: CareGroupResult[] = [];
    for (const group of preview.groups) {
      results.push(await this.sendAndRecordGroup(user, group, dto, content));
    }

    return {
      request_id: dto.request_id,
      results,
      totals: {
        groups: results.length,
        sent: results.filter((item) => item.status === 'sent').length,
        failed: results.filter((item) => item.status === 'failed').length,
        in_progress: results.filter((item) => item.status === 'in_progress')
          .length,
        record_failed: results.filter((item) => item.status === 'record_failed')
          .length,
        orders_affected: results.reduce(
          (sum, item) => sum + item.order_ids.length,
          0,
        ),
        orders_skipped: results.reduce(
          (sum, item) => sum + item.skipped_order_ids.length,
          0,
        ),
      },
      skipped: preview.skipped,
    };
  }

  async getOrderHistory(
    user: any,
    orderId: number,
    query: CareHistoryQueryDto,
  ) {
    const orderDetail = await this.orderDetailRepository.findOne({
      where: { id: orderId },
      relations: ['order', 'order.sale_by'],
    });
    if (!orderDetail) {
      throw new NotFoundException('Order detail not found');
    }

    await this.assertCanView(user, orderDetail.order?.sale_by?.id);

    const page = query.page || 1;
    const pageSize = Math.min(query.pageSize || 20, 200);

    const [careItems, total] = await this.careItemRepository.findAndCount({
      where: { order_detail_id: orderId },
      relations: ['batch'],
      order: { cared_at: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const statusHistory = await this.statusHistoryRepository.find({
      where: { order_detail_id: orderId },
      order: { changed_at: 'DESC', id: 'DESC' },
      take: 100,
    });

    return {
      order: this.toOrderSummary(orderDetail),
      care: {
        data: careItems,
        total,
        page,
        pageSize,
      },
      status: statusHistory,
    };
  }

  async getBatch(user: any, batchId: number) {
    const batch = await this.careBatchRepository.findOne({
      where: { id: batchId },
      relations: ['items'],
    });
    if (!batch) {
      throw new NotFoundException('Care batch not found');
    }
    await this.assertCanView(user, batch.user_id);

    const orderIds = (batch.items || []).map((item) => item.order_detail_id);
    const orders = orderIds.length
      ? await this.orderDetailRepository.find({
          where: { id: In(orderIds) },
        })
      : [];

    return {
      batch,
      orders: orders.map((item) => this.toOrderSummary(item)),
    };
  }

  private async sendAndRecordGroup(
    user: any,
    group: CareGroupPlan,
    dto: CareSendDto,
    content: string,
  ): Promise<CareGroupResult> {
    const requestId = createHash('sha1')
      .update(`${dto.request_id}:${group.key}`)
      .digest('hex');

    let batch = await this.careBatchRepository.findOne({
      where: { request_id: requestId },
      relations: ['items'],
    });

    if (batch) {
      if (batch.status === OrderCareBatchStatus.SENT) {
        return this.buildExistingResult(group, batch);
      }

      if (batch.status === OrderCareBatchStatus.SENDING) {
        const ageMs = Date.now() - new Date(batch.updated_at || batch.created_at).getTime();
        if (ageMs < 2 * 60 * 1000) {
          return this.buildResult(group, batch, 'in_progress', []);
        }
        await this.careBatchRepository.update(batch.id, {
          status: OrderCareBatchStatus.FAILED,
          error_message: 'Batch gửi quá lâu, cho phép thử lại',
        });
        batch.status = OrderCareBatchStatus.FAILED;
      }

      if (
        batch.status === OrderCareBatchStatus.FAILED &&
        !batch.sent_at
      ) {
        await this.careBatchRepository.update(batch.id, {
          status: OrderCareBatchStatus.SENDING,
          error_message: null,
        });
        batch.status = OrderCareBatchStatus.SENDING;
      }
    } else {
      batch = await this.careBatchRepository.save(
        this.careBatchRepository.create({
          request_id: requestId,
          user_id: user?.id ?? null,
          user_name_snapshot: user?.fullName || user?.username || null,
          source_message_id: group.source_message_id,
          zalo_customer_id: group.zalo_customer_id,
          customer_type: group.customer_type,
          content,
          preset_id: dto.preset_id ?? null,
          status: OrderCareBatchStatus.SENDING,
          order_count: group.all_order_ids.length,
        }),
      );
    }

    // record_failed (hoặc failed nhưng đã có sent_at): message đã gửi,
    // chỉ cần ghi lại DB, tuyệt đối không gửi lại Zalo.
    if (
      batch.sent_at &&
      (batch.status === OrderCareBatchStatus.RECORD_FAILED ||
        batch.status === OrderCareBatchStatus.FAILED)
    ) {
      return this.recordGroup(user, group, batch, true);
    }

    try {
      let contentSent = content;
      let sendHistoryId: number | null = null;

      if (process.env.ORDER_CARE_DRY_RUN !== 'true') {
        const response = await this.pythonApi.sendQuote({
          user_id: user.id,
          message_content: content,
          zalo_customer_id: group.zalo_customer_id,
          customer_type: group.customer_type,
          msg_id: group.source_message_id,
          send_function: 'order_care',
          notes: `OrderCareBatch:${batch.id}`,
        });

        if (!response?.success) {
          const error =
            response?.error || response?.message || 'Gửi quote thất bại';
          await this.careBatchRepository.update(batch.id, {
            status: OrderCareBatchStatus.FAILED,
            error_message: error,
          });
          batch.status = OrderCareBatchStatus.FAILED;
          return this.buildResult(group, batch, 'failed', [], error);
        }

        contentSent = response?.data?.processed_message_content || content;
        sendHistoryId = response?.data?.send_history_id ?? null;
      }

      const sentAt = new Date();

      await this.careBatchRepository.update(batch.id, {
        content_sent: contentSent,
        send_history_id: sendHistoryId,
        sent_at: sentAt,
        status: OrderCareBatchStatus.SENDING,
        error_message: null,
      });
      batch.content_sent = contentSent;
      batch.send_history_id = sendHistoryId;
      batch.sent_at = sentAt;

      return await this.recordGroup(user, group, batch, false);
    } catch (error: any) {
      const message = error?.message || 'Gửi quote thất bại';
      await this.careBatchRepository.update(batch.id, {
        status: OrderCareBatchStatus.FAILED,
        error_message: message,
      });
      batch.status = OrderCareBatchStatus.FAILED;
      return this.buildResult(group, batch, 'failed', [], message);
    }
  }

  private async recordGroup(
    user: any,
    group: CareGroupPlan,
    batch: OrderCareBatch,
    retryOnly: boolean,
  ): Promise<CareGroupResult> {
    try {
      const result = await this.orderStatusContextService.runWithContext(
        {
          actorId: user?.id ?? null,
          actorName: user?.fullName || user?.username || null,
          source: 'care',
          note: 'Chăm sóc đơn hàng',
          careBatchId: batch.id,
        },
        async (manager) => {
          const detailRepo = manager.getRepository(OrderDetail);
          const locked = await detailRepo
            .createQueryBuilder('detail')
            .setLock('pessimistic_write')
            .where('detail.id IN (:...ids)', { ids: group.all_order_ids })
            .andWhere('detail.deleted_at IS NULL')
            .getMany();

          const affected: number[] = [];
          const skipped: number[] = [];
          let maxCareCount = 0;

          for (const detail of locked) {
            if (!isCareEligibleStatus(detail.status)) {
              skipped.push(Number(detail.id));
              continue;
            }

            const before = normalizeOrderStatus(detail.status);
            const after =
              before === OrderDetailStatus.QUOTED
                ? OrderDetailStatus.CARED
                : before;
            const careCountBefore = Number(detail.care_count || 0);

            await detailRepo.update(detail.id, {
              care_count: () => 'care_count + 1',
              first_cared_at: () => 'COALESCE(first_cared_at, NOW(3))',
              last_cared_at: () => 'NOW(3)',
              status: after,
            });

            await manager.getRepository(OrderCareItem).insert({
              batch_id: batch.id,
              order_detail_id: detail.id,
              order_id: detail.order_id,
              status_before: before,
              status_after: after,
              care_count_before: careCountBefore,
              care_count_after: careCountBefore + 1,
              cared_at: new Date(),
            });

            affected.push(Number(detail.id));
            maxCareCount = Math.max(maxCareCount, careCountBefore + 1);
          }

          // order không nằm trong locked (đã bị xoá/không tìm thấy)
          for (const id of group.all_order_ids) {
            if (!locked.some((item) => Number(item.id) === Number(id))) {
              skipped.push(Number(id));
            }
          }

          await manager.getRepository(OrderCareBatch).update(batch.id, {
            status: OrderCareBatchStatus.SENT,
            order_count: affected.length,
            sent_at: batch.sent_at || new Date(),
            content_sent: batch.content_sent,
            send_history_id: batch.send_history_id,
            error_message: null,
          });

          return {
            affected,
            skipped: Array.from(new Set(skipped)),
            maxCareCount,
          };
        },
      );

      batch.status = OrderCareBatchStatus.SENT;
      return {
        batch_id: Number(batch.id),
        source_message_id: group.source_message_id,
        zalo_customer_id: group.zalo_customer_id,
        customer_type: group.customer_type,
        status: 'sent',
        order_ids: result.affected,
        added_order_ids: group.expanded_order_ids.filter((id) =>
          result.affected.includes(id),
        ),
        skipped_order_ids: result.skipped,
        care_count: result.maxCareCount,
        sent_at: (batch.sent_at || new Date()).toISOString(),
      };
    } catch (error: any) {
      const message = error?.message || 'Gửi thành công nhưng ghi nhận thất bại';
      this.logger.error(
        `Care batch ${batch.id} record failed: ${message}`,
        error?.stack,
      );
      await this.careBatchRepository.update(batch.id, {
        status: OrderCareBatchStatus.RECORD_FAILED,
        error_message: message,
      });
      batch.status = OrderCareBatchStatus.RECORD_FAILED;
      return this.buildResult(
        group,
        batch,
        'record_failed',
        group.all_order_ids,
        retryOnly
          ? `${message} — thử lại cùng request_id để ghi nhận, không gửi lại`
          : message,
      );
    }
  }

  private async loadSelectedDetails(
    orderIds: number[],
    user: any,
    includeHidden: boolean,
  ): Promise<OrderDetail[]> {
    if (!orderIds?.length) return [];

    const qb = this.orderDetailRepository
      .createQueryBuilder('detail')
      .leftJoinAndSelect('detail.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .where('detail.id IN (:...orderIds)', { orderIds })
      .andWhere('detail.deleted_at IS NULL')
      .andWhere('sale_by.id = :userId', { userId: user.id });

    if (!includeHidden) {
      qb.andWhere('detail.hidden_at IS NULL');
    }

    return qb.getMany();
  }

  private async loadSiblings(
    user: any,
    sourceMessageId: string,
    includeHidden: boolean,
  ): Promise<OrderDetail[]> {
    const prefix = `${sourceMessageId}\\_product\\_%`;
    const qb = this.orderDetailRepository
      .createQueryBuilder('detail')
      .leftJoinAndSelect('detail.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .where('sale_by.id = :userId', { userId: user.id })
      .andWhere('detail.deleted_at IS NULL')
      .andWhere(
        `(detail.zalo_message_id = :sourceMessageId
          OR detail.zalo_message_id LIKE :prefix
          OR JSON_UNQUOTE(JSON_EXTRACT(detail.metadata, '$.trigger_message_id')) = :sourceMessageId)`,
        { sourceMessageId, prefix },
      );

    if (!includeHidden) {
      qb.andWhere('detail.hidden_at IS NULL');
    }

    return qb.getMany();
  }

  private resolveSourceMessageId(detail: OrderDetail): string | null {
    const metadata = this.metadataOf(detail);
    const raw =
      metadata?.trigger_message_id ??
      metadata?.unique_zalo_message_id ??
      detail.zaloMessageId;
    if (raw === null || raw === undefined || raw === '') return null;
    return String(raw).replace(/_product_\d+$/, '');
  }

  private resolveCustomerInfo(
    detail: OrderDetail,
    sourceMessageId: string,
  ): {
    customerId: string;
    customerType: OrderCareCustomerType;
    customerName: string | null;
    sourceContent: string | null;
  } | null {
    const metadata = this.metadataOf(detail);
    const conversationInfo = metadata?.conversation_info || {};
    const customerId =
      metadata?.customer_id ??
      conversationInfo?.zalo_conversation_id ??
      metadata?.zalo_customer_id;
    if (customerId === null || customerId === undefined || customerId === '') {
      return null;
    }

    const isGroupRaw = conversationInfo?.is_group;
    const isGroup =
      isGroupRaw === true ||
      isGroupRaw === 1 ||
      isGroupRaw === '1' ||
      String(isGroupRaw).toLowerCase() === 'true';
    const customerType = isGroup
      ? OrderCareCustomerType.GROUP
      : OrderCareCustomerType.PRIVATE;

    const messages = Array.isArray(metadata?.messages)
      ? metadata.messages
      : [];
    const sourceMessage = messages.find(
      (message: any) =>
        String(message?.message_id) === String(sourceMessageId) ||
        String(message?.message_id) === String(detail.zaloMessageId),
    );
    let sourceContent = sourceMessage?.content ?? null;
    if (typeof sourceContent === 'string' && sourceContent.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(sourceContent);
        if (typeof parsed?.text === 'string') {
          sourceContent = parsed.text;
        } else if (parsed?.text?.title) {
          sourceContent = String(parsed.text.title);
        }
      } catch {
        // keep raw
      }
    }

    return {
      customerId: String(customerId),
      customerType,
      customerName:
        detail.customer_name ||
        conversationInfo?.conversation_name ||
        null,
      sourceContent: sourceContent ? String(sourceContent) : null,
    };
  }

  private metadataOf(detail: OrderDetail): Record<string, any> {
    const raw: any = (detail as any).metadata;
    if (!raw) return {};
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    }
    return raw;
  }

  private toOrderSummary(detail: OrderDetail): CareOrderSummary {
    return {
      id: Number(detail.id),
      order_id: Number(detail.order_id),
      raw_item: detail.raw_item ?? null,
      quantity: Number(detail.quantity || 0),
      unit_price: Number(detail.unit_price || 0),
      status: detail.status,
      care_count: Number(detail.care_count || 0),
      customer_name: detail.customer_name ?? null,
      is_project: !!detail.is_project,
    };
  }

  private async assertCanView(user: any, saleId: number | null | undefined) {
    if (!saleId) return;
    const allowedUserIds = await this.orderService.getUserIdsByRole(user);
    if (allowedUserIds === null) return;
    if (!allowedUserIds.includes(Number(saleId))) {
      throw new ForbiddenException('Bạn không có quyền xem đơn hàng này');
    }
  }

  private buildExistingResult(
    group: CareGroupPlan,
    batch: OrderCareBatch,
  ): CareGroupResult {
    const itemOrderIds = (batch.items || []).map((item) =>
      Number(item.order_detail_id),
    );
    const orderIds = itemOrderIds.length ? itemOrderIds : group.all_order_ids;
    return {
      batch_id: Number(batch.id),
      source_message_id: group.source_message_id,
      zalo_customer_id: group.zalo_customer_id,
      customer_type: group.customer_type,
      status: 'sent',
      order_ids: orderIds,
      added_order_ids: group.expanded_order_ids.filter((id) =>
        orderIds.includes(id),
      ),
      skipped_order_ids: group.all_order_ids.filter(
        (id) => !orderIds.includes(id),
      ),
      care_count: (batch.items || []).reduce(
        (max, item) => Math.max(max, Number(item.care_count_after || 0)),
        0,
      ),
      sent_at: batch.sent_at ? new Date(batch.sent_at).toISOString() : undefined,
    };
  }

  private buildResult(
    group: CareGroupPlan,
    batch: OrderCareBatch,
    status: CareGroupResult['status'],
    orderIds: number[],
    error?: string,
  ): CareGroupResult {
    return {
      batch_id: batch.id ? Number(batch.id) : null,
      source_message_id: group.source_message_id,
      zalo_customer_id: group.zalo_customer_id,
      customer_type: group.customer_type,
      status,
      order_ids: orderIds,
      added_order_ids: group.expanded_order_ids.filter((id) =>
        orderIds.includes(id),
      ),
      skipped_order_ids: group.all_order_ids.filter(
        (id) => !orderIds.includes(id),
      ),
      care_count: 0,
      sent_at: batch.sent_at ? new Date(batch.sent_at).toISOString() : undefined,
      error,
    };
  }
}
