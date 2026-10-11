import { Controller, Get, Header } from '@nestjs/common';

import { Public } from '../common/decorators/public.decorator';

/**
 * Pages légales servies en HTML public.
 *
 * L'App Store et le Play Store exigent une URL HTTPS accessible SANS
 * compte. Ces routes sont cette URL, tant qu'aucun site vitrine dédié
 * n'est encore en ligne.
 *
 * ⚠️ Ces textes doivent décrire ce que le code FAIT réellement. Ils
 * annonçaient un encaissement par agrégateur (CinetPay / PayDunya) alors que
 * la décision commerciale est le **paiement direct manuel** vers le numéro
 * officiel d'AGRIM : une politique de confidentialité fausse est un motif de
 * rejet en revue Play Store, et une information trompeuse pour le client.
 */

const CADRE = (titre: string, corps: string) => `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titre} · AGRIM / BÉLIER D’OR</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1a1a1a;line-height:1.55}
  h1{color:#0B5D1E} h2{margin-top:1.6em;font-size:1.1em}
  p,li{color:#333}
</style>
</head>
<body>
<h1>${titre}</h1>
<p><strong>AGRIM</strong> · marque <strong>BÉLIER D’OR</strong><br>
Siège Yamoussoukro, Côte d'Ivoire · +225 07 00 05 04 52</p>
${corps}
<p><small>Dernière mise à jour : 11 octobre 2026.</small></p>
</body></html>`;

const CONFIDENTIALITE = CADRE(
  'Politique de confidentialité',
  `
<h2>1. Données collectées</h2>
<p>Nous collectons uniquement ce qui sert à livrer votre riz et à vérifier votre paiement :</p>
<ul>
  <li>identité (nom, prénom) et téléphone ; e-mail facultatif ;</li>
  <li>adresses de livraison et, si vous l'autorisez, votre position pendant une livraison ;</li>
  <li>historique de commandes ;</li>
  <li>déclarations de paiement : opérateur choisi, référence de transaction fournie par votre opérateur, montant annoncé, et le justificatif que vous joignez si vous le souhaitez ;</li>
  <li>identifiant technique de votre installation et jeton de notification, pour vous prévenir même application fermée.</li>
</ul>
<p><strong>Nous ne demandons et ne stockons jamais votre code secret ni votre
code de validation Mobile Money. Aucune donnée bancaire n'est collectée.</strong></p>
<h2>2. Utilisation</h2>
<p>Préparer et livrer les commandes, <strong>vérifier la réception effective des
paiements</strong>, vous prévenir (notifications, SMS), prévenir la fraude,
améliorer le service. Aucune revente de données à des publicitaires. Aucune
publicité personnalisée.</p>
<h2>3. Comment vous payez</h2>
<p>AGRIM <strong>n'utilise aucun agrégateur de paiement</strong> pour encaisser
les nouvelles commandes. Vous transférez vous-même le montant, depuis votre
application Mobile Money, vers le numéro officiel d'AGRIM affiché dans
l'application, en indiquant la référence de votre commande. Vous pouvez
déclarer ce transfert dans l'application : la commande reste alors
<em>en attente de vérification</em> jusqu'à ce qu'un responsable AGRIM constate
la réception réelle des fonds. Aucun paiement n'est validé automatiquement.</p>
<h2>4. Destinataires</h2>
<p>Équipe AGRIM, livreurs affectés à votre commande, prestataire d'envoi des
SMS et des notifications. Votre déclaration de paiement et son justificatif ne
sont consultables que par les responsables habilités d'AGRIM. Les codes de
livraison ne transitent jamais par un canal tiers.</p>
<h2>5. Conservation</h2>
<p>Compte et commandes : le temps de la relation commerciale, puis les
obligations comptables. Un compte supprimé est anonymisé ; les commandes
restent pour la comptabilité, sans votre nom ni votre numéro. Les justificatifs
de paiement sont supprimés après la période de vérification et de comptabilité.</p>
<h2>6. Vos droits</h2>
<p>Accès, correction, suppression : depuis l'application (Mon compte →
Supprimer mon compte) ou au +225 07 00 05 04 52. La suppression est
irréversible.</p>
<h2>7. Notifications</h2>
<p>Vous pouvez désactiver les notifications promotionnelles à tout moment
(Mon compte → Notifications). Les messages liés à vos commandes et à la
vérification de vos paiements restent nécessaires au service rendu.</p>
<h2>8. Sécurité</h2>
<p>Mots de passe hachés, sessions révocables, communications HTTPS en
production, contrôle d'accès sur les justificatifs de paiement. La localisation
n'est demandée que pendant une tournée de livraison, jamais en arrière-plan.</p>
<h2>9. Contact</h2>
<p>AGRIM — Yamoussoukro — +225 07 00 05 04 52.</p>
`,
);

const CGU = CADRE(
  "Conditions générales d'utilisation",
  `
<h2>1. Objet</h2>
<p>L'application AGRIM permet de commander du riz BÉLIER D'OR, d'en suivre la
livraison et, pour l'équipe, de gérer tournées, stocks et paiements.</p>
<h2>2. Compte</h2>
<p>La consultation du catalogue et la commande <strong>ne nécessitent aucun
compte</strong> : un nom et un numéro ivoirien valide suffisent. Créer un compte
reste possible pour retrouver son historique. Vous pouvez supprimer votre compte
à tout moment depuis l'application.</p>
<h2>3. Commandes et prix</h2>
<p>Les prix affichés sont en francs CFA. Le prix encaissé est celui en vigueur
au moment de la validation, <strong>recalculé par le serveur</strong>. Le stock
n'est garanti qu'à la confirmation. Les frais de livraison sont confirmés par
AGRIM avant la remise ; ils ne sont pas encaissés en ligne.</p>
<h2>4. Paiement</h2>
<p>Deux possibilités : <strong>espèces à la livraison</strong>, ou
<strong>transfert Mobile Money direct</strong> vers le numéro officiel d'AGRIM
affiché dans l'application, avec la référence de commande. Pour un transfert,
la commande reste <em>en attente de vérification</em> : elle n'est préparée
qu'après confirmation de la réception réelle des fonds par un responsable
AGRIM. Une déclaration de paiement, même accompagnée d'une capture d'écran, ne
vaut pas preuve : seule la vérification sur le compte de réception fait foi.</p>
<h2>5. Livraison et retrait</h2>
<p>Délais indicatifs selon la zone. Un code de livraison, visible uniquement
dans l'application, confirme la remise. Le retrait en point de vente est
possible lorsqu'un point de vente est proposé pour votre zone.</p>
<h2>6. Annulation</h2>
<p>Possible par le client tant que la commande n'est pas encore chez le livreur
en route, selon les règles affichées. Le stock est alors restitué.</p>
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
