import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
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

  /**
   * Consultation d'une preuve.
   *
   * Ces fichiers étaient auparavant servis en statique sur `/files/` : une
   * signature manuscrite était lisible par quiconque connaissait l'URL. La
   * lecture passe désormais par ce point d'entrée authentifié.
   */
  @Get('proofs/:id')
  @ApiOperation({ summary: 'Consulter une preuve de livraison' })
  @ApiParam({ name: 'id', description: 'Identifiant du fichier' })
  // Donnée personnelle : ni cache partagé, ni conservation par un intermédiaire.
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  // Le contenu est téléchargé, jamais interprété comme une page.
  @Header('Content-Disposition', 'inline')
  async readProof(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const { content, mimeType } = await this.files.readProof(id, user);
    res.type(mimeType).send(content);
  }
}
