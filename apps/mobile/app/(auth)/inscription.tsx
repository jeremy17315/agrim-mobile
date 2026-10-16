import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { passwordSchema, phoneSchema, REFERRAL_CODE_LENGTH } from '@agrim/contracts';

import { describeError } from '@/api/errors';
import { Banner, Button, Icon, Input, Text } from '@/components/ui';
import { useAuthStore } from '@/store/auth';
import { palette, spacing } from '@/theme/tokens';

/**
 * Création de compte — DEUX champs seulement.
 *
 * Le téléphone est déjà l'identifiant de connexion en Côte d'Ivoire, et le mot
 * de passe suffit à protéger le compte : exiger un prénom, un nom et une
 * seconde saisie du mot de passe écartait des clients sans rien apporter à la
 * livraison. Le nom est demandé au moment de la commande, exactement comme
 * pour un client sans compte.
 *
 * Les informations facultatives (nom, e-mail, code de parrainage) restent
 * accessibles, mais repliées : elles n'encombrent pas le parcours par défaut.
 *
 * La validation reproduit celle du serveur pour montrer l'erreur avant
 * l'aller-retour réseau — la règle qui fait foi reste celle du backend.
 */

const schema = z.object({
  // Règle partagée : normalise les espaces de saisie et valide le format.
  phone: phoneSchema,
  password: passwordSchema,
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  email: z.union([z.literal(''), z.email('Email invalide')]).optional(),
  referralCode: z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .regex(
          new RegExp(`^[A-Za-z0-9]{${REFERRAL_CODE_LENGTH}}$`),
          `Code à ${REFERRAL_CODE_LENGTH} caractères`,
        ),
    ])
    .optional(),
});

type FormValues = z.infer<typeof schema>;

export default function InscriptionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const signUp = useAuthStore((s) => s.signUp);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showOptional, setShowOptional] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      phone: '',
      password: '',
      firstName: '',
      lastName: '',
      email: '',
      referralCode: '',
    },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await signUp({
        phone: values.phone,
        password: values.password,
        // Chaîne vide = information non fournie : on n'envoie pas de champ
        // vide au serveur, qui les accepte désormais facultatifs.
        ...(values.firstName ? { firstName: values.firstName } : {}),
        ...(values.lastName ? { lastName: values.lastName } : {}),
        ...(values.email ? { email: values.email } : {}),
        ...(values.referralCode
          ? { referralCode: values.referralCode.toUpperCase() }
          : {}),
      });

      // On revient d'où l'on vient : du catalogue, on retrouve le catalogue ;
      // de l'écran de confirmation, la commande qui vient d'être passée.
      if (router.canGoBack?.()) router.back();
      else router.replace('/(tabs)');
    } catch (error) {
      setSubmitError(describeError(error));
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Retour"
            hitSlop={12}
          >
            <Icon name="arrow-left" size={19} color="ink" />
          </Pressable>
        </View>

        <View style={styles.form}>
          <Text variant="h1">Créer un compte</Text>
          <Text variant="caption" color="muted">
            Votre numéro et un mot de passe suffisent.
          </Text>

          {submitError ? (
            <Banner
              tone="danger"
              message={submitError}
              icon={<Icon name="triangle-alert" size={14} color="danger" />}
            />
          ) : null}

          <Controller
            control={control}
            name="phone"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Numéro de téléphone"
                placeholder="07 00 00 00 01"
                required
                keyboardType="phone-pad"
                autoComplete="tel"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.phone?.message}
                hint="Il servira à vous connecter."
              />
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Mot de passe"
                placeholder="8 caractères minimum"
                required
                secureTextEntry={!showPassword}
                autoComplete="new-password"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.password?.message}
                hint="Au moins une lettre et un chiffre."
                trailing={
                  <Pressable
                    onPress={() => setShowPassword((visible) => !visible)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      showPassword
                        ? 'Masquer le mot de passe'
                        : 'Afficher le mot de passe'
                    }
                    hitSlop={10}
                  >
                    <Icon
                      name={showPassword ? 'eye-off' : 'eye'}
                      size={19}
                      color="muted"
                    />
                  </Pressable>
                }
              />
            )}
          />

          <Pressable
            onPress={() => setShowOptional((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showOptional }}
            accessibilityLabel="Ajouter des informations facultatives"
            hitSlop={8}
            style={styles.optionalToggle}
          >
            <Icon
              name={showOptional ? 'chevron-up' : 'chevron-down'}
              size={15}
              color="green"
            />
            <Text variant="caption" color="green">
              Ajouter mon nom, mon e-mail ou un code de parrainage
            </Text>
          </Pressable>

          {showOptional ? (
            <View style={styles.optional}>
              <Controller
                control={control}
                name="firstName"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="Prénom"
                    placeholder="Awa"
                    autoComplete="given-name"
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.firstName?.message}
                  />
                )}
              />

              <Controller
                control={control}
                name="lastName"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="Nom"
                    placeholder="Koné"
                    autoComplete="family-name"
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.lastName?.message}
                    hint="Facultatif — demandé à la commande de toute façon."
                  />
                )}
              />

              <Controller
                control={control}
                name="email"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="Email"
                    placeholder="awa.kone@example.ci"
                    hint="Facultatif"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.email?.message}
                  />
                )}
              />

              <Controller
                control={control}
                name="referralCode"
                render={({ field: { onChange, onBlur, value } }) => (
                  <Input
                    label="Code de parrainage"
                    placeholder="AB12CD"
                    hint="Facultatif — donné par la personne qui vous a invité"
                    autoCapitalize="characters"
                    value={value ?? ''}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    error={errors.referralCode?.message}
                  />
                )}
              />
            </View>
          ) : null}

          <Button
            label={isSubmitting ? 'Création…' : 'Créer mon compte'}
            disabled={isSubmitting}
            onPress={() => void handleSubmit(onSubmit)()}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  header: { flexDirection: 'row' },
  form: { gap: spacing.md },
  optionalToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  optional: { gap: spacing.md },
});
