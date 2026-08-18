/**
 * Seed AGRIM-Mobile.
 *
 * Contient les données AGRIM réelles connues (gammes, formats, contacts) et
 * des valeurs PROVISOIRES clairement identifiées (prix, stocks) issues de
 * @agrim/contracts. Modifier les valeurs métier là-bas, pas ici.
 */
import 'dotenv/config';
import * as argon2 from 'argon2';

import {
  COMPANY,
  PACK_FORMATS,
  PROVISIONAL_DELIVERY,
  PROVISIONAL_PRICING,
  RICE_RANGES,
} from '@agrim/contracts';
import { prisma } from '../src/prisma/prisma.client';

/** Mots de passe de DÉVELOPPEMENT uniquement. */
const DEV_PASSWORD = 'Agrim2026!';

type RangeSlug = keyof typeof PROVISIONAL_PRICING;

async function main() {
  console.log('🌾  Seed AGRIM-Mobile…');

  // Idempotent : on repart d'une base propre à chaque seed de dev.
  await prisma.$transaction([
    prisma.orderEvent.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.delivery.deleteMany(),
    prisma.order.deleteMany(),
    prisma.cartItem.deleteMany(),
    prisma.cart.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.production.deleteMany(),
    prisma.farm.deleteMany(),
    prisma.producer.deleteMany(),
    prisma.productVariant.deleteMany(),
    prisma.product.deleteMany(),
    prisma.category.deleteMany(),
    prisma.address.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.pushToken.deleteMany(),
    prisma.user.deleteMany(),
    prisma.companySetting.deleteMany(),
    prisma.orderCounter.deleteMany(),
  ]);

  /* ── Paramètres société ─────────────────────────────────────────────── */
  await prisma.companySetting.createMany({
    data: [
      { key: 'name', value: COMPANY.name },
      { key: 'slogan', value: COMPANY.slogan },
      { key: 'brandName', value: COMPANY.brandName },
      { key: 'brandSignature', value: COMPANY.brandSignature },
      { key: 'address', value: COMPANY.address },
      { key: 'phone', value: COMPANY.phone },
      { key: 'secondaryPhone', value: COMPANY.secondaryPhone },
      { key: 'deliveryBaseFee', value: String(PROVISIONAL_DELIVERY.baseFee) },
      {
        key: 'freeDeliveryThreshold',
        value: String(PROVISIONAL_DELIVERY.freeDeliveryThreshold),
      },
    ],
  });

  /* ── Utilisateurs de développement (un par rôle) ────────────────────── */
  const passwordHash = await argon2.hash(DEV_PASSWORD);
  const mk = (
    firstName: string,
    lastName: string,
    phone: string,
    role: 'CLIENT' | 'LIVREUR' | 'PRODUCTEUR' | 'GESTIONNAIRE' | 'ADMIN' | 'DG',
  ) => ({ firstName, lastName, phone, role, passwordHash });

  await prisma.user.createMany({
    data: [
      mk('Awa', 'Koné', '0700000001', 'CLIENT'),
      mk('Yao', 'Kouassi', '0700000002', 'LIVREUR'),
      mk('Salif', 'Traoré', '0700000003', 'PRODUCTEUR'),
      mk('Mariam', 'Bamba', '0700000004', 'GESTIONNAIRE'),
      mk('Admin', 'AGRIM', '0700000005', 'ADMIN'),
      mk('Direction', 'Générale', '0700000006', 'DG'),
    ],
  });

  const client = await prisma.user.findUniqueOrThrow({
    where: { phone: '0700000001' },
  });
  const courier = await prisma.user.findUniqueOrThrow({
    where: { phone: '0700000002' },
  });
  const producerUser = await prisma.user.findUniqueOrThrow({
    where: { phone: '0700000003' },
  });

  /* ── Adresse client (modèle GPS + repères) ──────────────────────────── */
  const address = await prisma.address.create({
    data: {
      userId: client.id,
      label: 'Domicile',
      city: 'Yamoussoukro',
      commune: 'Kokrenou',
      district: 'Quartier Millionnaire',
      landmark: 'En face de la pharmacie du Lac, portail vert',
      instructions: 'Appeler en arrivant, la cour est au fond de la ruelle.',
      contactPhone: '0700000001',
      latitude: 6.8276,
      longitude: -5.2893,
      isDefault: true,
    },
  });

  /* ── Catalogue : 4 gammes × 3 formats ───────────────────────────────── */
  for (const range of RICE_RANGES) {
    const category = await prisma.category.create({
      data: {
        slug: range.slug,
        name: range.name,
        description: range.description,
        sortOrder: range.sortOrder,
      },
    });

    const pricing = PROVISIONAL_PRICING[range.slug as RangeSlug];

    await prisma.product.create({
      data: {
        slug: range.slug,
        name: `${COMPANY.brandName} ${range.name}`,
        shortDescription: range.description,
        description: `${range.description}. ${COMPANY.brandSignature}. Cultivé et transformé en ${COMPANY.country}.`,
        brand: COMPANY.brandName,
        categoryId: category.id,
        isFeatured: range.sortOrder <= 2,
        variants: {
          create: PACK_FORMATS.map((f) => ({
            sku: `BOAGNI-${range.slug.toUpperCase()}-${f.weightGrams}`,
            label: f.label,
            weightGrams: f.weightGrams,
            price: pricing[f.weightGrams as keyof typeof pricing],
            // PROVISOIRE : stocks réels non communiqués.
            stock: f.weightGrams === 22500 ? 40 : 200,
          })),
        },
      },
    });
  }

  /* ── Producteur ─────────────────────────────────────────────────────── */
  const producer = await prisma.producer.create({
    data: {
      userId: producerUser.id,
      displayName: 'Coopérative Salif Traoré',
      region: 'Gbêkê',
      farms: {
        create: {
          name: 'Exploitation de Bouaké-Nord',
          location: 'Bouaké, région de Gbêkê',
          areaHectares: 12.5,
          latitude: 7.6906,
          longitude: -5.0303,
        },
      },
    },
    include: { farms: true },
  });

  // Trois déclarations couvrant les états que le producteur rencontrera :
  // une réceptionnée (saison close), une confirmée, une en attente de revue.
  await prisma.production.createMany({
    data: [
      {
        farmId: producer.farms[0].id,
        season: 'Saison 2025',
        cropVariety: 'Riz long grain',
        quantityKg: 15400,
        targetKg: 16000,
        harvestedAt: new Date('2025-06-20'),
        status: 'RECEIVED',
        reviewedAt: new Date('2025-06-28'),
      },
      {
        farmId: producer.farms[0].id,
        season: 'Saison 2026',
        cropVariety: 'Riz long grain',
        quantityKg: 18000,
        targetKg: 20500,
        harvestedAt: new Date('2026-06-15'),
        status: 'CONFIRMED',
        reviewedAt: new Date('2026-06-18'),
      },
      {
        farmId: producer.farms[0].id,
        season: 'Saison 2026',
        cropVariety: 'Riz violet',
        quantityKg: 2400,
        targetKg: 3000,
        harvestedAt: new Date('2026-08-02'),
        status: 'DECLARED',
      },
    ],
  });

  /* ── Commande de démonstration (chaîne complète, section 37) ────────── */
  const year = new Date().getFullYear();
  await prisma.orderCounter.create({ data: { year, current: 1 } });

  const royal = await prisma.product.findUniqueOrThrow({
    where: { slug: 'royal-grains' },
    include: { variants: true },
  });
  const variant5kg = royal.variants.find((v) => v.weightGrams === 5000)!;

  const quantity = 2;
  const subtotal = variant5kg.price * quantity;
  const deliveryFee =
    subtotal >= PROVISIONAL_DELIVERY.freeDeliveryThreshold
      ? 0
      : PROVISIONAL_DELIVERY.baseFee;

  const order = await prisma.order.create({
    data: {
      reference: `AGR-${year}-0001`,
      userId: client.id,
      status: 'CONFIRMED',
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      addressId: address.id,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      items: {
        create: {
          variantId: variant5kg.id,
          productName: royal.name,
          variantLabel: variant5kg.label,
          unitPrice: variant5kg.price,
          quantity,
          lineTotal: subtotal,
        },
      },
      events: {
        create: [{ status: 'PENDING' }, { status: 'CONFIRMED' }],
      },
      payment: {
        create: {
          method: 'CASH_ON_DELIVERY',
          status: 'PENDING',
          amount: subtotal + deliveryFee,
        },
      },
      delivery: {
        create: {
          status: 'ASSIGNED',
          courierId: courier.id,
          addressId: address.id,
          assignedAt: new Date(),
        },
      },
    },
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: client.id,
        type: 'ORDER_CONFIRMED',
        title: 'Commande confirmée',
        body: `Votre commande ${order.reference} a été confirmée.`,
        orderId: order.id,
      },
      {
        userId: courier.id,
        type: 'DELIVERY_ASSIGNED',
        title: 'Nouvelle mission',
        body: `Livraison ${order.reference} à ${address.commune}.`,
        orderId: order.id,
      },
    ],
  });

  await prisma.cart.create({ data: { userId: client.id } });

  const counts = {
    utilisateurs: await prisma.user.count(),
    catégories: await prisma.category.count(),
    produits: await prisma.product.count(),
    variantes: await prisma.productVariant.count(),
    commandes: await prisma.order.count(),
    notifications: await prisma.notification.count(),
  };
  console.log('✅  Seed terminé :', counts);
  console.log(
    `ℹ️   Comptes dev : 07000000 01→06 / mot de passe ${DEV_PASSWORD}`,
  );
}

main()
  .catch((e) => {
    console.error('❌ Seed échoué :', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
