import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { FilesService, PROOF_MAX_BYTES } from './files.service';

@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /**
   * Dépôt d'une preuve (signature tracée ou photo). Réservé au livreur : les
   * autres rôles n'ont aucune raison d'alimenter ce dossier.
   */
  @Roles('LIVREUR')
  @Post('proofs')
  @ApiOperation({ summary: 'Déposer une preuve de livraison' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      // La limite est appliquée AVANT de charger le fichier en mémoire.
      limits: { fileSize: PROOF_MAX_BYTES, files: 1 },
    }),
  )
  uploadProof(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.files.uploadProof(file, user.id);
  }
}
