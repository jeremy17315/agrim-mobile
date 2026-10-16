import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authentification FACULTATIVE : le jeton est lu s'il est là, ignoré sinon.
 *
 * ── Pourquoi ce garde existe ─────────────────────────────────────────────
 * Le devis (`POST /cart/quote`) et la commande invitée (`POST /orders/guest`)
 * sont PUBLICS : un visiteur sans compte doit pouvoir chiffrer son panier et
 * commander. Mais le crédit de parrainage appartient à un COMPTE — il ne peut
 * donc pas être appliqué sur la seule foi d'un numéro de téléphone envoyé par
 * le client (n'importe qui réclamerait le crédit d'un autre).
 *
 * Ces deux routes acceptent donc un jeton s'il y en a un : présente, la session
 * désigne le compte dont le crédit peut être consommé ; absente, la requête
 * reste servie exactement comme avant, sans crédit. Aucune route ne devient
 * protégée par ce garde — il ne fait qu'ajouter une identité possible.
 *
 * ── Ce qu'il ne fait JAMAIS ──────────────────────────────────────────────
 * Il ne transforme pas un jeton invalide ou expiré en erreur : un jeton abîmé
 * dans le stockage du téléphone ne doit pas empêcher un client de commander.
 * L'identité est alors simplement absente (`req.user = null`), donc aucun
 * crédit n'est appliqué — le refus tombe du côté « pas d'avantage », jamais du
 * côté « accès accordé ».
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(_err: unknown, user: TUser | false): TUser | null {
    return user || null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // `super.canActivate` échoue en levant si le jeton est présent mais
    // invalide : on le neutralise ici, le résultat `false` étant déjà traduit
    // en `req.user = null` par `handleRequest`.
    try {
      await super.canActivate(context);
    } catch {
      // Ignoré volontairement : voir le commentaire de classe.
    }
    return true;
  }
}
