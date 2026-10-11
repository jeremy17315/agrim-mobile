import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { describeError } from '@/api/errors';
import {
  useCreatePromoCode,
  useDeactivatePromoCode,
  usePromoCodes,
  useUpdatePromoCode,
  type PromoCode,
  type PromoCodeInput,
} from '@/api/promos';
import { EmptyState, ErrorState, Skeleton } from '@/components/states';
import { Banner, Button, Card, Icon, Input, Pill, Text } from '@/components/ui';
import { formatXof } from '@/lib/format';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Codes promo — écran d'administration (ADMIN et DG).
 *
 * Deux principes visibles dans l'interface :
 *
 *  1. **Rien n'est publié par défaut.** Un code créé reste « non publié »
 *     jusqu'à ce qu'un responsable le déclare relu — on ne diffuse pas une
 *     remise par accident de frappe.
 *  2. **La règle est décrite, jamais calculée ici.** L'écran saisit le type,
 *     la valeur, les bornes et les dates ; c'est le serveur qui applique la
 *     remise au panier, et lui seul.
 */
export default function PromotionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const codes = usePromoCodes();
  const create = useCreatePromoCode();
  const update = useUpdatePromoCode();
  const deactivate = useDeactivatePromoCode();

  const [enEdition, setEnEdition] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [valeur, setValeur] = useState('');
  const [minimum, setMinimum] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [maxParTelephone, setMaxParTelephone] = useState('1');
  const [zone, setZone] = useState('');
  const [fin, setFin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reinitialiser = () => {
    setEnEdition(null);
    setCode('');
    setDescription('');
    setType('PERCENT');
    setValeur('');
    setMinimum('');
    setMaxUses('');
    setMaxParTelephone('1');
    setZone('');
    setFin('');
    setError(null);
  };

  /** Charge un code existant dans le formulaire (modification). */
  const editer = (promo: PromoCode) => {
    setEnEdition(promo.code);
    setCode(promo.code);
    setDescription(promo.description ?? '');
    setType(promo.discountType);
    setValeur(String(promo.discountValue));
    setMinimum(promo.minOrderTotal ? String(promo.minOrderTotal) : '');
    setMaxUses(promo.maxUses ? String(promo.maxUses) : '');
    setMaxParTelephone(
      promo.maxUsesPerPhone ? String(promo.maxUsesPerPhone) : '',
    );
    setZone(promo.zone ?? '');
    setFin(promo.endsAt ? promo.endsAt.slice(0, 10) : '');
    setError(null);
  };

  const entier = (valeurChamp: string): number | undefined => {
    const chiffres = valeurChamp.replace(/\D/g, '');
    if (!chiffres) return undefined;
    const n = Number.parseInt(chiffres, 10);
    return Number.isSafeInteger(n) && n > 0 ? n : undefined;
  };

  const enregistrer = async () => {
    setError(null);
    const montant = entier(valeur);
    if (code.trim().length < 3) {
      setError('Le code doit contenir au moins 3 caractères.');
      return;
    }
    if (!montant) {
      setError('Indiquez la valeur de la remise.');
      return;
    }
    if (type === 'PERCENT' && montant > 100) {
      setError('Un pourcentage ne peut pas dépasser 100 %.');
      return;
    }
    if (fin && !/^\d{4}-\d{2}-\d{2}$/.test(fin.trim())) {
      setError('Date de fin attendue au format AAAA-MM-JJ.');
      return;
    }

    const payload: PromoCodeInput = {
      code: code.trim(),
      description: description.trim() || undefined,
      discountType: type,
      discountValue: montant,
      minOrderTotal: entier(minimum),
      maxUses: entier(maxUses),
      maxUsesPerPhone: entier(maxParTelephone),
      zone: zone.trim() || undefined,
      endsAt: fin.trim() ? `${fin.trim()}T23:59:59.000Z` : undefined,
    };

    try {
      if (enEdition) {
        await update.mutateAsync({
          id: codeId(
            (codes.data ?? []).find((c) => c.code === enEdition) ?? {
              code: enEdition,
            },
          ),
          discountValue: payload.discountValue,
          description: payload.description,
          minOrderTotal: payload.minOrderTotal,
          maxUses: payload.maxUses,
          maxUsesPerPhone: payload.maxUsesPerPhone,
          zone: payload.zone,
          endsAt: payload.endsAt,
        });
        Alert.alert(
          'Code modifié',
          'Les nouvelles règles s’appliqueront au prochain devis. Le code reste dans son état de publication.',
        );
      } else {
        await create.mutateAsync(payload);
        Alert.alert(
          'Code enregistré',
          'Le code est créé NON PUBLIÉ : relisez la valeur, puis publiez-le pour qu’il s’applique.',
        );
      }
      reinitialiser();
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  if (codes.isError) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
        <ErrorState error={codes.error} onRetry={() => void codes.refetch()} />
      </View>
    );
  }

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
          <Text variant="h3">Codes promo</Text>
          <Text variant="caption" color="muted">
            Remises appliquées par le serveur
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + spacing.xxxl },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={codes.isFetching && !codes.isLoading}
            onRefresh={() => void codes.refetch()}
            tintColor={palette.green}
          />
        }
      >
        <Card style={styles.form}>
          <View style={styles.formHeading}>
            <View style={styles.formIcon}>
              <Icon name="ticket-percent" size={17} color="green" />
            </View>
            <View style={styles.flex}>
              <Text variant="h3">
                {enEdition ? `Modifier ${enEdition}` : 'Nouveau code'}
              </Text>
              <Text variant="caption" color="muted">
                Un code créé reste non publié jusqu’à validation.
              </Text>
            </View>
          </View>

          {error ? (
            <Banner
              tone="danger"
              message={error}
              icon={<Icon name="triangle-alert" size={15} color="danger" />}
            />
          ) : null}

          <Input
            label="Code"
            value={code}
            onChangeText={setCode}
            placeholder="Ex. BIENVENUE10"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!enEdition}
          />
          <Input
            label="Description (interne)"
            value={description}
            onChangeText={setDescription}
            placeholder="Ex. 10 % sur la première commande"
          />

          <View style={styles.typeRow}>
            <TypeChoice
              actif={type === 'PERCENT'}
              label="Pourcentage"
              onPress={() => setType('PERCENT')}
            />
            <TypeChoice
              actif={type === 'FIXED'}
              label="Montant fixe"
              onPress={() => setType('FIXED')}
            />
          </View>

          <Input
            label={type === 'PERCENT' ? 'Valeur (%)' : 'Valeur (F CFA)'}
            value={valeur}
            onChangeText={setValeur}
            placeholder={type === 'PERCENT' ? 'Ex. 10' : 'Ex. 500'}
            keyboardType="number-pad"
          />
          <Input
            label="Panier minimum (F CFA, facultatif)"
            value={minimum}
            onChangeText={setMinimum}
            placeholder="Ex. 10000"
            keyboardType="number-pad"
          />
          <Input
            label="Utilisations maximum (facultatif)"
            value={maxUses}
            onChangeText={setMaxUses}
            placeholder="Vide = illimité"
            keyboardType="number-pad"
          />
          <Input
            label="Par numéro de téléphone (facultatif)"
            value={maxParTelephone}
            onChangeText={setMaxParTelephone}
            placeholder="Vide = illimité"
            keyboardType="number-pad"
            hint="Empêche un même client d’utiliser le code en boucle."
          />
          <Input
            label="Zone concernée (facultatif)"
            value={zone}
            onChangeText={setZone}
            placeholder="Vide = toutes les zones"
            hint="Clé de zone de la grille de livraison."
          />
          <Input
            label="Fin de validité (facultatif)"
            value={fin}
            onChangeText={setFin}
            placeholder="AAAA-MM-JJ"
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
          />

          <Button
            label={
              create.isPending || update.isPending
                ? 'ENREGISTREMENT…'
                : enEdition
                  ? 'ENREGISTRER LES MODIFICATIONS'
                  : 'CRÉER LE CODE'
            }
            disabled={create.isPending || update.isPending}
            onPress={() => void enregistrer()}
            icon={<Icon name="check" size={17} color="white" />}
          />
          {enEdition ? (
            <Button
              label="ANNULER LA MODIFICATION"
              variant="outline"
              onPress={reinitialiser}
            />
          ) : null}
        </Card>

        <Text variant="micro" color="muted">
          CODES EXISTANTS
        </Text>

        {codes.isLoading ? (
          <>
            <Skeleton height={96} />
            <Skeleton height={96} />
          </>
        ) : (codes.data ?? []).length === 0 ? (
          <EmptyState
            icon="ticket-percent"
            title="Aucun code promo"
            message="Créez un code ci-dessus : il ne s’appliquera qu’une fois publié."
          />
        ) : (
          (codes.data ?? []).map((promo) => (
            <Card key={promo.code} style={styles.promo}>
              <View style={styles.promoHead}>
                <View style={styles.flex}>
                  <Text variant="h3">{promo.code}</Text>
                  <Text variant="caption" color="muted">
                    {promo.description ?? 'Sans description'}
                  </Text>
                </View>
                <Pill
                  label={etiquette(promo)}
                  tone={promo.isActive ? 'green' : 'neutral'}
                />
              </View>

              <View style={styles.lignes}>
                <Ligne
                  label="Remise"
                  value={
                    promo.discountType === 'PERCENT'
                      ? `${promo.discountValue} %`
                      : formatXof(promo.discountValue)
                  }
                />
                <Ligne
                  label="Utilisations"
                  value={
                    promo.maxUses === null
                      ? `${promo.usedCount} / illimité`
                      : `${promo.usedCount} / ${promo.maxUses}`
                  }
                />
                {promo.minOrderTotal ? (
                  <Ligne
                    label="Panier minimum"
                    value={formatXof(promo.minOrderTotal)}
                  />
                ) : null}
                {promo.maxUsesPerPhone ? (
                  <Ligne
                    label="Par téléphone"
                    value={`${promo.maxUsesPerPhone}`}
                  />
                ) : null}
                {promo.zone ? <Ligne label="Zone" value={promo.zone} /> : null}
                {promo.endsAt ? (
                  <Ligne
                    label="Fin de validité"
                    value={promo.endsAt.slice(0, 10)}
                  />
                ) : null}
              </View>

              <View style={styles.actions}>
                {promo.isActive ? (
                  <Button
                    label="DÉSACTIVER"
                    variant="outline"
                    size="sm"
                    fullWidth={false}
                    disabled={deactivate.isPending}
                    onPress={() =>
                      Alert.alert(
                        `Désactiver ${promo.code} ?`,
                        'Le code ne s’appliquera plus aux nouvelles commandes. L’historique des utilisations est conservé.',
                        [
                          { text: 'Annuler', style: 'cancel' },
                          {
                            text: 'DÉSACTIVER',
                            style: 'destructive',
                            onPress: () =>
                              void deactivate
                                .mutateAsync(codeId(promo))
                                .catch((cause) =>
                                  setError(describeError(cause)),
                                ),
                          },
                        ],
                      )
                    }
                  />
                ) : (
                  <Button
                    label="PUBLIER CE CODE"
                    size="sm"
                    fullWidth={false}
                    disabled={update.isPending}
                    onPress={() =>
                      Alert.alert(
                        `Publier ${promo.code} ?`,
                        `Vérifiez la remise avant de publier : ${
                          promo.discountType === 'PERCENT'
                            ? `${promo.discountValue} %`
                            : formatXof(promo.discountValue)
                        }. Un code publié s’applique immédiatement.`,
                        [
                          { text: 'Annuler', style: 'cancel' },
                          {
                            text: 'PUBLIER',
                            onPress: () =>
                              void update
                                .mutateAsync({
                                  id: codeId(promo),
                                  isActive: true,
                                })
                                .catch((cause) =>
                                  setError(describeError(cause)),
                                ),
                          },
                        ],
                      )
                    }
                  />
                )}
                <Button
                  label="MODIFIER"
                  variant="outline"
                  size="sm"
                  fullWidth={false}
                  onPress={() => editer(promo)}
                />
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

/**
 * Identifiant technique d'un code.
 *
 * L'API travaille par `id` ; le contrat d'affichage porte le `code`. Le
 * serveur accepte les deux dans ses réponses : on prend l'identifiant s'il est
 * présent, sinon on retombe sur le code — jamais sur une valeur inventée.
 */
function codeId(promo: { id?: string; code: string }): string {
  return promo.id ?? promo.code;
}

function etiquette(promo: PromoCode): string {
  if (!promo.isActive) return 'NON PUBLIÉ';
  if (promo.endsAt && new Date(promo.endsAt).getTime() < Date.now()) {
    return 'EXPIRÉ';
  }
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) return 'ÉPUISÉ';
  return 'PUBLIÉ';
}

function Ligne({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.ligne}>
      <Text variant="caption" color="muted">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

function TypeChoice({
  actif,
  label,
  onPress,
}: {
  actif: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: actif }}
      accessibilityLabel={label}
      style={[styles.type, actif && styles.typeActif]}
    >
      <Text variant="caption" style={{ color: actif ? palette.white : palette.body }}>
        {label}
      </Text>
    </Pressable>
  );
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
  body: { gap: spacing.md, padding: spacing.lg },
  form: { gap: spacing.md, padding: spacing.lg },
  formHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  formIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: palette.greenSoft,
  },
  typeRow: { flexDirection: 'row', gap: spacing.sm },
  type: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.card,
  },
  typeActif: { backgroundColor: palette.green, borderColor: palette.green },
  promo: { gap: spacing.sm, padding: spacing.lg },
  promoHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lignes: { gap: spacing.xs },
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
