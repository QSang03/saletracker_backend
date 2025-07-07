import { Controller, Get, Post, Body, Param, Put, Delete } from '@nestjs/common';
import { NKCProductService } from './nkc_product.service';
import { NKCProduct } from './nkc_product.entity';

@Controller('nkc-products')
export class NKCProductController {
  constructor(private readonly nkcProductService: NKCProductService) {}

  @Get()
  findAll() {
    return this.nkcProductService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.nkcProductService.findOne(id);
  }

  @Post()
  create(@Body() data: Partial<NKCProduct>) {
    return this.nkcProductService.create(data);
  }

  @Put(':id')
  update(@Param('id') id: number, @Body() data: Partial<NKCProduct>) {
    return this.nkcProductService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: number) {
    return this.nkcProductService.remove(id);
  }
}
