// PC-54 W54-11 slice 1 module.
import { Module } from '@nestjs/common';
import { CatalogueDepthController } from './catalogue-depth.controller';
import { CatalogueDepthService } from './catalogue-depth.service';

@Module({ controllers: [CatalogueDepthController], providers: [CatalogueDepthService] })
export class CatalogueDepthModule {}
