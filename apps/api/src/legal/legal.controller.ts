import { Controller, Get, Header } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';

/**
 * Pages légales servies en HTML public.
 *
 * L'App Store et le Play Store exigent une URL HTTPS accessible SANS
 * compte. Ces routes sont cette URL, tant qu'aucun site vitrine dédié
 * n'est encore en ligne.
 */

const CADRE = (titre: string, corps: string) => `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titre} · AGRIM / RIZ BOAGNI</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1a1a1a;line-height:1.55}
  h1{color:#0B5D1E} h2{margin-top:1.6em;font-size:1.1em}
  p,li{color:#333}
</style>
</head>
<body>
<h1>${titre}</h1>
<p><strong>AGRIM</strong> · marque <strong>RIZ BOAGNI</strong><br>
Siège Yamoussoukro, Côte d'Ivoire · +225 07 00 05 04 52</p>
${corps}
<p><small>Dernière mise à jour : 25 août 2026.</small></p>
</body></html>`;

const CONFIDENTIALITE = CADRE(
  'Politique de confidentialité',
  `
<h2>1. Données collectées</h2>
<p>Nous collectons uniquement ce qui sert à livrer votre riz :</p>
<ul>
  <li>identité (nom, prénom) ;</li>
  <li>téléphone (identifiant de connexion) et e-mail facultatif ;</li>
  <li>adresses de livraison et, si vous l'autorisez, votre position pendant une livraison ;</li>
  <li>historique de commandes et de paiements (références, montants, pas le code PIN) ;</li>
  <li>jeton de notification poussée de votre appareil.</li>
</ul>
<h2>2. Utilisation</h2>
<p>Préparer et livrer les commandes, vous prévenir (push, SMS via le site),
prévenir la fraude, améliorer le service. Pas de revente à des publicitaires.
Pas de publicité personnalisée.</p>
<h2>3. Destinataires</h2>
<p>Équipe AGRIM, livreurs affectés à votre commande, agrégateur de paiement
(CinetPay / PayDunya) pour encaisser, site riz-boagni pour les SMS. Les codes
de livraison ne transissent jamais par un canal tiers.</p>
<h2>4. Conservation</h2>
<p>Compte et commandes : le temps de la relation commerciale, puis les
obligations comptables. Un compte supprimé est anonymisé ; les commandes
restent pour la comptabilité, sans votre nom ni votre numéro.</p>
<h2>5. Vos droits</h2>
<p>Accès, correction, suppression : depuis l'application (Mon compte →
Supprimer mon compte) ou au +225 07 00 05 04 52. La suppression est
irréversible.</p>
<h2>6. Sécurité</h2>
<p>Mots de passe hachés, sessions révocables, communications HTTPS en
production. La localisation n'est demandée que pendant une tournée, jamais
en arrière-plan.</p>
<h2>7. Contact</h2>
<p>AGRIM — Yamoussoukro — +225 07 00 05 04 52.</p>
`,
);

const CGU = CADRE(
  "Conditions générales d'utilisation",
  `
<h2>1. Objet</h2>
<p>L'application AGRIM permet de commander du riz RIZ BOAGNI, de suivre
la livraison et, pour l'équipe, de gérer tournées et stocks.</p>
<h2>2. Compte</h2>
<p>Un numéro ivoirien valide est requis. Vous êtes responsable de la
confidentialité de votre mot de passe. Vous pouvez supprimer votre compte
à tout moment depuis l'application.</p>
<h2>3. Commandes et prix</h2>
<p>Les prix affichés sont en F CFA. Le prix encaissé est celui en vigueur
au moment de la validation, recalculé par le serveur. Le stock n'est
garanti qu'à la confirmation.</p>
<h2>4. Paiement</h2>
<p>Espèces à la livraison, ou Mobile Money (Wave, Orange, MTN, Moov) via
l'agrégateur configuré. Un paiement validé n'est pas annulable unilatéralement.</p>
<h2>5. Livraison</h2>
<p>Délais indicatifs selon la zone. Un code de livraison, visible uniquement
dans l'application, confirme la remise.</p>
<h2>6. Annulation</h2>
<p>Possible par le client tant que la commande n'est pas encore chez le
livreur en route, selon les règles affichées. Le stock est alors restitué.</p>
<h2>7. Responsabilité</h2>
<p>AGRIM livre le riz commandé en l'état décrit. En cas de litige : contact
téléphonique, puis les juridictions de Yamoussoukro.</p>
`,
);

@Public()
@Controller('legal')
export class LegalController {
  @Get('confidentialite')
  @Header('content-type', 'text/html; charset=utf-8')
  confidentialite(): string {
    return CONFIDENTIALITE;
  }

  @Get('cgu')
  @Header('content-type', 'text/html; charset=utf-8')
  cgu(): string {
    return CGU;
  }
}
