import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { Express } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AutoReplyService } from './auto_reply.service';
import { PersonaPatchDto, PersonaUpsertDto } from './dto/persona.dto';
import {
  AssignPersonaBulkDto,
  AssignPersonaDto,
  RenameContactDto,
  ToggleAutoReplyBulkDto,
} from './dto/contacts.dto';
import {
  BulkAllowedProductsDto,
  PatchAllowedProductsDto,
} from './dto/allowed-products.dto';
import {
  BulkCreateKeywordDto,
  CreateKeywordDto,
  PatchKeywordDto,
} from './dto/keywords.dto';
import { WebhookService } from '../webhook/webhook.service';
import { UpdateRoleDto } from './dto/role.dto';
import { ProfilePatchDto } from './dto/profile.dto';

@Controller('auto-reply')
export class AutoReplyController {
  constructor(
    private readonly svc: AutoReplyService,
    private readonly webhook: WebhookService,
  ) {}

  // Persona
  @Get('persona/me')
  mePersona(@Req() req: any, @Query('userId') userIdFromQuery?: string) {
    const userId =
      req.user?.id ?? (userIdFromQuery ? parseInt(userIdFromQuery) : undefined);
    if (!userId && userId !== 0) {
      throw new BadRequestException(
        'Missing userId. Provide JWT or query param ?userId=',
      );
    }
    return this.svc.getMyPersona(userId);
  }

  @Post('persona')
  upsertPersona(@Req() req: any, @Body() body: PersonaUpsertDto) {
    const userId = req.user?.id ?? body.userId;
    if (userId === undefined || userId === null) {
      throw new BadRequestException(
        'Missing userId in body and no JWT. Provide body.userId',
      );
    }
    return this.svc.upsertPersona(userId, body);
  }

  @Patch('persona/:personaId')
  patchPersona(
    @Req() req: any,
    @Param('personaId', ParseIntPipe) personaId: number,
    @Body() body: PersonaPatchDto,
  ) {
    const userId = req.user?.id ?? body.userId;
    if (userId === undefined || userId === null) {
      throw new BadRequestException(
        'Missing userId in body and no JWT. Provide body.userId',
      );
    }
    return this.svc.updatePersonaById(personaId, body, userId);
  }

  // Contacts
  @Get('contacts')
  listContacts(
    @Req() req: any,
    @Query('mine') mine?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Query('search') search?: string,
    @Query('userId') userIdFromQuery?: string,
  ) {
    const userId =
      req.user?.id ?? (userIdFromQuery ? parseInt(userIdFromQuery) : undefined);
    if (userId === undefined || userId === null) {
      throw new BadRequestException('Missing userId (JWT or ?userId=)');
    }
    // Always scope contacts to the current user
    return this.svc.listContactsForUser(userId);
  }

  @Patch('contacts/:contactId/role')
  updateRole(
    @Param('contactId', ParseIntPipe) cid: number,
    @Body() body: UpdateRoleDto,
  ) {
    return this.svc.updateContactRole(cid, body.role);
  }

  @Patch('contacts/:contactId/persona')
  assignPersona(
    @Param('contactId', ParseIntPipe) cid: number,
    @Body() body: AssignPersonaDto,
  ) {
    return this.svc.assignPersona(cid, (body.personaId ?? null) as any);
  }

  @Patch('contacts/:contactId/auto-reply')
  toggleAutoReply(
    @Param('contactId', ParseIntPipe) cid: number,
    @Body('enabled', new DefaultValuePipe(true)) enabled: boolean,
  ) {
    return this.svc.toggleContactAutoReply(cid, !!enabled);
  }

  @Patch('contacts/auto-reply-bulk')
  toggleAutoReplyBulk(
    @Req() req: any,
    @Body() body: ToggleAutoReplyBulkDto,
    @Query('userId') userIdFromQuery?: string,
  ) {
    const uid =
      req?.user?.id ??
      (userIdFromQuery ? parseInt(userIdFromQuery) : undefined);
    if (uid === undefined || uid === null) {
      throw new BadRequestException('Missing userId (JWT or ?userId=)');
    }
    return this.svc.bulkToggleAutoReply(
      (body.contactIds ?? 'ALL') as any,
      !!body.enabled,
      uid,
    );
  }

  @Patch('contacts/persona-bulk')
  assignPersonaBulk(
    @Req() req: any,
    @Body() body: AssignPersonaBulkDto,
    @Query('userId') userIdFromQuery?: string,
  ) {
    const uid =
      req?.user?.id ??
      (userIdFromQuery ? parseInt(userIdFromQuery) : undefined);
    if (uid === undefined || uid === null) {
      throw new BadRequestException('Missing userId (JWT or ?userId=)');
    }
    return this.svc.assignPersonaBulk(
      (body.contactIds ?? 'ALL') as any,
      (body.personaId ?? null) as any,
      uid,
    );
  }

  // Settings
  @Get('settings')
  getSettings() {
    return this.svc.getGlobalAutoReplySetting();
  }

  @Patch('settings')
  patchSettings(@Body('enabled') enabled: boolean) {
    return this.svc.setGlobalAutoReplySetting(!!enabled);
  }

  // Products
  @Get('products')
  listProducts() {
    return this.svc.listProducts();
  }

  @Get('products.paginated')
  listProductsPaginated(
    @Req() req: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit = 10,
    @Query('search') search?: string,
    @Query('brands') brands?: string | string[],
    @Query('cates') cates?: string | string[],
    @Query('myAllowed') myAllowed?: string,
  @Query('activeForContact') activeForContact?: string,
    @Query('userId') userIdFromQuery?: string,
    @Query('contactId') contactIdFromQuery?: string,
  ) {
    const arr = (v?: string | string[]) =>
      Array.isArray(v) ? v : v ? [v] : [];
    const uid =
      req?.user?.id ??
      (userIdFromQuery ? parseInt(userIdFromQuery) : undefined);
    const allowedForUserId =
      (myAllowed === '1' || myAllowed === 'true') && uid
        ? Number(uid)
        : undefined;
    const prioritizeContactId = contactIdFromQuery
      ? parseInt(contactIdFromQuery)
      : undefined;
    const activeForContactId =
      (activeForContact === '1' || activeForContact === 'true') &&
      contactIdFromQuery
        ? parseInt(contactIdFromQuery)
        : undefined;
    return this.svc.listProductsPaginated({
      page,
      limit,
      search,
      brands: arr(brands),
      cates: arr(cates),
      allowedForUserId,
      prioritizeContactId,
      activeForContactId,
    });
  }

  @Get('products.meta')
  getProductsMeta() {
    return this.svc.getProductsMeta();
  }

  @Post('products/import')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  importProducts(@UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer) throw new BadRequestException('Missing file');
    return this.svc.importProductsFromExcel(file.buffer);
  }

  @Get('contacts/:contactId/allowed-products')
  getAllowed(@Param('contactId', ParseIntPipe) cid: number) {
    return this.svc.getAllowedProducts(cid);
  }

  @Patch('contacts/:contactId/allowed-products')
  patchAllowed(
    @Param('contactId', ParseIntPipe) cid: number,
    @Body() body: PatchAllowedProductsDto,
  ) {
    return this.svc.patchAllowedProducts(cid, body.productIds, body.active);
  }

  @Patch('allowed-products/bulk')
  bulkAllowed(
    @Req() req: any,
    @Body() body: BulkAllowedProductsDto,
    @Query('userId') userIdFromQuery?: string,
  ) {
    const uid =
      req?.user?.id ??
      (userIdFromQuery ? parseInt(userIdFromQuery) : undefined);
    if (uid === undefined || uid === null) {
      throw new BadRequestException(
        'Missing userId (JWT or ?userId=) for scoped bulk operation',
      );
    }
    return this.svc.bulkAllowedProducts(
      (body.contactIds ?? 'ALL') as any,
      body.productIds,
      body.active,
      uid,
    );
  }

  @Post('allowed-products/bulk')
  bulkAllowedPost(
    @Req() req: any,
    @Body() body: BulkAllowedProductsDto,
    @Query('userId') userIdFromQuery?: string,
  ) {
    const uid =
      req?.user?.id ??
      (userIdFromQuery ? parseInt(userIdFromQuery) : undefined);
    if (uid === undefined || uid === null) {
      throw new BadRequestException(
        'Missing userId (JWT or ?userId=) for scoped bulk operation',
      );
    }
    return this.svc.bulkAllowedProducts(
      (body.contactIds ?? 'ALL') as any,
      body.productIds,
      body.active,
      uid,
    );
  }

  // My allowed products across all my contacts
  @Get('allowed-products/mine')
  myAllowedProducts(
    @Req() req: any,
    @Query('userId') userIdFromQuery?: string,
    @Query('flat') flat?: string,
  ) {
    const uid =
      req?.user?.id ??
      (userIdFromQuery ? parseInt(userIdFromQuery) : undefined);
    if (uid === undefined || uid === null) {
      throw new BadRequestException('Missing userId (JWT or ?userId=)');
    }
    return this.svc.listMyAllowedProducts(uid).then((rows) => {
      if (flat === '1' || flat === 'true') {
        // Return unique productIds only
        const set = new Set<number>();
        rows.forEach((r) => set.add(Number(r.productId)));
        return Array.from(set.values());
      }
      return rows;
    });
  }

  // Keyword routes
  @Get('keywords')
  listRoutes(@Query('contactId') contactId?: string) {
    if (contactId === undefined) return this.svc.listKeywordRoutes();
    if (contactId === 'null') return this.svc.listKeywordRoutes(null);
    return this.svc.listKeywordRoutes(parseInt(contactId));
  }

  @Post('keywords')
  createRoute(@Body() body: CreateKeywordDto) {
    const { keyword, contactId, routeProducts } = body;
    return this.svc.createKeywordRoute(
      keyword,
      contactId ?? null,
      routeProducts,
    );
  }

  @Post('keywords/bulk')
  bulkCreateRoute(@Body() body: BulkCreateKeywordDto) {
    const {
      keyword,
      contactIds,
      productIds,
      defaultPriority = 0,
      active = true,
    } = body;
    return this.svc.createKeywordRoutesBulk(
      keyword,
      contactIds,
      productIds,
      defaultPriority,
      active,
    );
  }

  @Patch('keywords/:routeId')
  updateRoute(
    @Param('routeId', ParseIntPipe) routeId: number,
    @Body() patch: PatchKeywordDto,
  ) {
    return this.svc.updateKeywordRoute(routeId, patch as any);
  }

  @Delete('keywords/:routeId')
  removeRoute(@Param('routeId', ParseIntPipe) routeId: number) {
    return this.svc.deleteKeywordRoute(routeId);
  }

  // Profiles
  @Get('contacts/:contactId/profile')
  getProfile(@Param('contactId', ParseIntPipe) cid: number) {
    return this.svc.getProfile(cid);
  }

  @Patch('contacts/:contactId/profile')
  patchProfile(
    @Param('contactId', ParseIntPipe) cid: number,
    @Body() patch: ProfilePatchDto,
  ) {
    return this.svc.patchProfile(cid, patch);
  }

  // Optional: paginated list
  @Get('contacts.paginated')
  listContactsPaginated(
    @Req() req: any,
    @Query('mine') mine?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Query('search') search?: string,
    @Query('userId') userIdFromQuery?: string,
  ) {
    const userId =
      req.user?.id ?? (userIdFromQuery ? parseInt(userIdFromQuery) : undefined);
    return this.svc.listContactsPaginated({
      userId,
      mine: mine === '1' || mine === 'true',
      page,
      limit,
      search,
    });
  }

  // Conversations & messages
  @Get('conversations')
  getConvByQuery(
    @Query('contactId', new DefaultValuePipe(0), ParseIntPipe)
    contactId: number,
  ) {
    return contactId ? this.svc.getConversationByContact(contactId) : null;
  }

  @Get('messages')
  listMsgsByQuery(
    @Query('convId', ParseIntPipe) convId: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('pageSize', new DefaultValuePipe(50), ParseIntPipe) pageSize = 50,
  ) {
    return this.svc.listMessages(convId, page, pageSize);
  }

  // Rename + webhook placeholder
  @Patch('contacts/:contactId/rename')
  rename(
    @Param('contactId', ParseIntPipe) cid: number,
    @Body() body: RenameContactDto,
  ) {
    return this.svc.renameContact(cid, body.newName);
  }

  @Post('zalo/rename-webhook')
  renameWebhook(@Body() body: any) {
    return this.webhook.queueRenameContact({
      contactId: body.contactId,
      zaloContactId: body.zaloContactId,
      newName: body.newName,
      requestedByUserId: body.userId,
    });
  }
}
