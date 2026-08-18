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

import { passwordSchema, phoneSchema } from '@agrim/contracts';

import { describeError } from '@/api/errors';
import { Banner, Button, Icon, Input, Text } from '@/components/ui';
import { useAuthStore } from '@/store/auth';
import { palette, spacing } from '@/theme/tokens';

/**
 * Création de compte.
 *
 * L'e-mail est facultatif : l'exiger exclurait une partie des clients. Les
 * règles de mot de passe reproduisent celles du serveur pour que l'utilisateur
 * voie l'erreur avant l'aller-retour réseau — la validation qui fait foi reste
 * évidemment celle du backend.
 */

const schema = z
  .object({
    firstName: z.string().trim().min(1, 'Prénom requis').max(80),
    lastName: z.string().trim().min(1, 'Nom requis').max(80),
    // Règle partagée : normalise les espaces de saisie et valide le format.
    phone: phoneSchema,
    email: z.union([z.literal(''), z.email('Email invalide')]).optional(),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Les mots de passe ne correspondent pas',
  });

type FormValues = z.infer<typeof schema>;

export default function InscriptionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const signUp = useAuthStore((s) => s.signUp);

  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: '',
      lastName: '',
      phone: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await signUp({
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        phone: values.phone,
        // Chaîne vide = pas d'email : on n'envoie pas un champ vide au serveur.
        ...(values.email ? { email: values.email.trim() } : {}),
        password: values.password,
      });
      router.replace('/(tabs)');
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
            Quelques informations suffisent pour commander.
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
            name="firstName"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Prénom"
                placeholder="Awa"
                required
                autoComplete="given-name"
                value={value}
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
                required
                autoComplete="family-name"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.lastName?.message}
              />
            )}
          />

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
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Mot de passe"
                placeholder="8 caractères minimum"
                required
                secureTextEntry
                autoComplete="new-password"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.password?.message}
                hint="Au moins une lettre et un chiffre"
              />
            )}
          />

          <Controller
            control={control}
            name="confirmPassword"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Confirmer le mot de passe"
                required
                secureTextEntry
                autoComplete="new-password"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.confirmPassword?.message}
              />
            )}
          />

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
});
