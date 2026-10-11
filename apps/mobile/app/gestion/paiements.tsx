import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { API_BASE_URL, currentAccessToken } from '@/api/client';
import {
  usePaymentDeclarations,
  useReviewPayment,
  type PendingDeclaration,
} from '@/api/management';
import { EmptyState, ErrorState, Skeleton } from '@/components/states';
import { Banner, Button, Card, Icon, Input, Pill, Text } from '@/components/ui';
import { formatDateTime, formatXof } from '@/lib/format';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * File de vérification des paiements par transfert direct.
 *
 * Chaque dossier porte TOUT ce qu'il faut pour décider sans quitter l'écran :
 * commande, client, montant attendu (figé), montant annoncé, moyen et numéro de
 * réception, référence de transaction, date de déclaration, justificatif.
 *
 * Deux garde-fous visibles ici :
 *  - on ne confirme qu'après avoir réellement constaté les fonds reçus ; le
 *    bouton est un acte de caisse, tracé au nom de son auteur ;
 *  - un rejet EXIGE un motif : le client le recevra, sinon il ne comprendrait
 *    pas pourquoi son transfert n'est pas reconnu.
 */
export default function GestionPaiementsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [filtre, setFiltre] = useState<'A_VERIFIER' | 'ACCEPTED' | 'REJECTED'>(
    'A_VERIFIER',
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const query = usePaymentDeclarations(
    filtre === 'A_VERIFIER' ? {} : { status: filtre },
  );
  const review = useReviewPayment();

  const dossiers = query.data?.data ?? [];

  const decide = (dossier: PendingDeclaration, decision: 'CONFIRM' | 'REJECT') => {
    setError(null);
    if (decision === 'REJECT' && note.trim().length < 3) {
      setError('Indiquez le motif du rejet : il sera transmis au client.');
      return;
    }

    const libelle =
      decision === 'CONFIRM'
        ? `Confirmer la réception de ${formatXof(dossier.expectedAmount)} ` +
          `pour ${dossier.orderReference} ?`
        : `Rejeter la déclaration ${dossier.transactionReference} ?`;

    Alert.alert(
      decision === 'CONFIRM' ? 'Confirmer ce paiement' : 'Rejeter ce paiement',
      decision === 'CONFIRM'
        ? `${libelle}\n\nNe confirmez qu'après avoir constaté les fonds reçus : ` +
          `cette action confirme la commande et engage AGRIM.`
        : libelle,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: decision === 'CONFIRM' ? 'CONFIRMER' : 'REJETER',
          style: decision === 'CONFIRM' ? 'default' : 'destructive',
          onPress: () => {
            review.mutate(
              {
                declarationId: dossier.declarationId,
                decision,
                note: note.trim() || undefined,
                rejectionNote:
                  decision === 'REJECT' ? note.trim() : undefined,
              },
              {
                onSuccess: () => {
                  setSelectedId(null);
                  setNote('');
                },
                onError: (cause) => setError(messageDe(cause)),
              },
            );
          },
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          hitSlop={12}
          style={styles.backButton}
        >
          <Icon name="arrow-left" size={19} color="ink" />
        </Pressable>
        <View style={styles.flex}>
          <Text variant="h3">Paiements à vérifier</Text>
          <Text variant="caption" color="muted">
            Transferts déclarés par les clients
          </Text>
        </View>
      </View>

      <View style={styles.filters}>
        {(
          [
            ['A_VERIFIER', 'À vérifier'],
            ['ACCEPTED', 'Confirmés'],
            ['REJECTED', 'Rejetés'],
          ] as const
        ).map(([value, label]) => {
          const active = filtre === value;
          return (
            <Pressable
              key={value}
              onPress={() => {
                setFiltre(value);
                setSelectedId(null);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Filtre ${label}`}
              style={[styles.filter, active && styles.filterActive]}
            >
              <Text
                variant="caption"
                style={{ color: active ? palette.white : palette.body }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + spacing.xxl },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching && !query.isLoading}
            onRefresh={() => void query.refetch()}
            tintColor={palette.green}
          />
        }
      >
        {query.isLoading ? (
          <>
            <Skeleton height={120} />
            <Skeleton height={120} />
          </>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : dossiers.length === 0 ? (
          <EmptyState
            icon="check-circle"
            title="Aucun paiement à vérifier"
            message="Les déclarations des clients apparaîtront ici, du plus ancien au plus récent."
          />
        ) : (
          dossiers.map((dossier) => {
            const ouvert = selectedId === dossier.declarationId;
            return (
              <Card key={dossier.declarationId} style={styles.dossier}>
                <Pressable
                  onPress={() =>
                    setSelectedId(ouvert ? null : dossier.declarationId)
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Dossier ${dossier.orderReference}`}
                >
                  <View style={styles.dossierHead}>
                    <View style={styles.flex}>
                      <Text variant="h3">{dossier.orderReference}</Text>
                      <Text variant="caption" color="muted">
                        {dossier.customerName || 'Client'} ·{' '}
                        {dossier.customerPhone}
                      </Text>
                    </View>
                    <Pill
                      label={statutLabel(dossier)}
                      tone={
                        dossier.paymentStatus === 'SUCCEEDED'
                          ? 'green'
                          : dossier.paymentStatus === 'REJECTED'
                            ? 'danger'
                            : 'warn'
                      }
                    />
                  </View>

                  <View style={styles.lines}>
                    <Ligne
                      label="Montant attendu"
                      value={formatXof(dossier.expectedAmount)}
                    />
                    <Ligne
                      label="Montant déclaré"
                      value={formatXof(dossier.declaredAmount)}
                      alerte={!dossier.amountMatches}
                    />
                    {!dossier.amountMatches ? (
                      <Text variant="caption" color="danger">
                        Écart de montant : vérifiez avant de confirmer.
                      </Text>
                    ) : null}
                    <Ligne
                      label="Moyen"
                      value={
                        dossier.paymentMethodCode ?? '—'
                      }
                    />
                    <Ligne
                      label="Numéro de réception"
                      value={dossier.receivingNumber ?? '—'}
                    />
                    <Ligne
                      label="Référence transaction"
                      value={dossier.transactionReference}
                    />
                    <Ligne
                      label="Déclaré le"
                      value={formatDateTime(dossier.submittedAt)}
                    />
                    <Ligne
                      label="Justificatif"
                      value={
                        dossier.hasProof
                          ? dossier.proofMimeType?.startsWith('image/')
                            ? 'Image jointe'
                            : 'PDF joint'
                          : 'Aucun'
                      }
                    />
                  </View>

                  {ouvert && dossier.hasProof ? <Justificatif id={dossier.declarationId} mime={dossier.proofMimeType} /> : null}

                  {ouvert && dossier.lastReview ? (
                    <Text variant="caption" color="muted">
                      Dernière décision : {dossier.lastReview.action}
                      {dossier.lastReview.actorName
                        ? ` par ${dossier.lastReview.actorName}`
                        : ''}
                      {dossier.lastReview.note
                        ? ` — « ${dossier.lastReview.note} »`
                        : ''}
                    </Text>
                  ) : null}
                </Pressable>

                {ouvert ? (
                  <View style={styles.decision}>
                    {error ? (
                      <Banner
                        tone="danger"
                        message={error}
                        icon={
                          <Icon name="triangle-alert" size={15} color="danger" />
                        }
                      />
                    ) : null}
                    <Input
                      label="Note / motif (obligatoire pour rejeter)"
                      value={note}
                      onChangeText={setNote}
                      placeholder="Ex. Fonds reçus sur le compte marchand, référence vérifiée."
                      multiline
                      editable={!review.isPending}
                    />
                    <Button
                      label={
                        review.isPending
                          ? 'ENREGISTREMENT…'
                          : 'CONFIRMER LA RÉCEPTION DES FONDS'
                      }
                      disabled={
                        review.isPending ||
                        dossier.paymentStatus === 'SUCCEEDED' ||
                        dossier.paymentStatus === 'REJECTED'
                      }
                      onPress={() => decide(dossier, 'CONFIRM')}
                      icon={<Icon name="check" size={17} color="white" />}
                    />
                    <Button
                      label="REJETER LA DÉCLARATION"
                      variant="outline"
                      disabled={review.isPending}
                      onPress={() => decide(dossier, 'REJECT')}
                      icon={<Icon name="x" size={17} color="green" />}
                    />
                    <Button
                      label="OUVRIR LA COMMANDE"
                      variant="outline"
                      onPress={() =>
                        router.push(`/gestion/${dossier.orderReference}`)
                      }
                      icon={
                        <Icon name="external-link" size={17} color="green" />
                      }
                    />
                  </View>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

/** Libellé court du statut, du point de vue du gestionnaire. */
function statutLabel(dossier: PendingDeclaration): string {
  switch (dossier.paymentStatus) {
    case 'SUCCEEDED':
      return 'CONFIRMÉ';
    case 'REJECTED':
      return 'REJETÉ';
    case 'UNDER_REVIEW':
      return 'EN VÉRIFICATION';
    case 'DECLARED_BY_CUSTOMER':
      return 'DÉCLARÉ';
    default:
      return dossier.paymentStatus;
  }
}

function Ligne({
  label,
  value,
  alerte = false,
}: {
  label: string;
  value: string;
  alerte?: boolean;
}) {
  return (
    <View style={styles.ligne}>
      <Text variant="caption" color="muted">
        {label}
      </Text>
      <Text
        variant="bodyStrong"
        style={alerte ? styles.valeurAlerte : undefined}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * Justificatif — prévisualisation des IMAGES uniquement.
 *
 * Le fichier n'est jamais public : l'en-tête d'autorisation accompagne la
 * requête de l'image, et la route répond `private, no-store`. Un PDF n'est pas
 * rendu ici — l'écran le dit, plutôt que d'afficher une vignette cassée.
 */
function Justificatif({ id, mime }: { id: string; mime: string | null }) {
  if (Platform.OS === 'web' || !mime?.startsWith('image/')) {
    return (
      <Text variant="caption" color="muted">
        Justificatif joint — ouvrez la console d’administration pour le
        consulter en grand.
      </Text>
    );
  }

  const token = currentAccessToken();
  return (
    <Image
      accessibilityLabel="Justificatif déposé par le client"
      source={{
        uri: `${API_BASE_URL}/management/payments/declarations/${id}/justificatif`,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }}
      style={styles.justificatif}
      resizeMode="contain"
    />
  );
}

/** Message lisible pour un refus serveur (409 : déjà réglé par un collègue). */
function messageDe(cause: unknown): string {
  const erreur = cause as { code?: string; message?: string };
  if (erreur?.code === 'PAYMENT_ALREADY_SETTLED') {
    return 'Ce paiement a déjà été réglé (par vous ou par un collègue) : rien n’a été appliqué deux fois.';
  }
  if (erreur?.code === 'REJECTION_NOTE_REQUIRED') {
    return 'Indiquez le motif du rejet : le client le recevra.';
  }
  return erreur?.message ?? 'Action impossible pour le moment.';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  flex: { flex: 1 },
  filters: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  filter: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.card,
  },
  filterActive: { backgroundColor: palette.green, borderColor: palette.green },
  list: { gap: spacing.md, padding: spacing.lg },
  dossier: { gap: spacing.md, padding: spacing.lg },
  dossierHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  lines: { gap: spacing.xs, marginTop: spacing.sm },
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  valeurAlerte: { color: palette.danger },
  decision: { gap: spacing.sm, marginTop: spacing.sm },
  justificatif: {
    width: '100%',
    height: 220,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: palette.line,
  },
});
