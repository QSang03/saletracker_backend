import { Controller, Get, Post, Body, Param, Put, Delete, Query, Req, UseGuards } from '@nestjs/common';
import { ProductService } from './product.service';
import { Product } from './product.entity';
import { AuthGuard } from '../common/guards/auth.guard';
import { Request } from 'express';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @UseGuards(AuthGuard)
  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('brands') brandsCsv?: string, // comma-separated brand names
    @Query('categoryIds') categoryIdsCsv?: string, // comma-separated category IDs
    @Query('page') page?: string,
      @Query('pageSize') pageSize?: string,
      @Query('pmCustomMode') pmCustomMode?: string, // Thêm parameter cho chế độ PM
      @Query('pmPermissions') pmPermissions?: string, // Thêm parameter cho PM permissions
      @Query('rolePermissions') rolePermissions?: string, // Thêm parameter cho thông tin từng role
      @Req() req?: Request,
    ) {
    const brands = brandsCsv
      ? brandsCsv
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : undefined;
    const categoryIds = categoryIdsCsv
      ? categoryIdsCsv
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => !isNaN(n))
      : undefined;
    const pageNum = page ? Number(page) : undefined;
    const pageSizeNum = pageSize ? Number(pageSize) : undefined;
      console.log('🔍 [Product Controller] Received pmCustomMode:', pmCustomMode);
      console.log('🔍 [Product Controller] Received pmPermissions:', pmPermissions);
      console.log('🔍 [Product Controller] Received rolePermissions:', rolePermissions);
  
  return this.productService.findAll({ search, brands, categoryIds, page: pageNum, pageSize: pageSizeNum, user: (req as any)?.user, pmCustomMode, pmPermissions, rolePermissions });
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.productService.findOne(id);
  }

  @Post()
  create(@Body() data: Partial<Product>) {
    return this.productService.create(data);
  }

  @Put(':id')
  update(@Param('id') id: number, @Body() data: Partial<Product>) {
    return this.productService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: number) {
    return this.productService.remove(id);
  }
}
