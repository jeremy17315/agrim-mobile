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

import { phoneSchema } from '@agrim/contracts';

import { describeError } from '@/api/errors';
import { Banner, Button, Icon, Input, Text } from '@/components/ui';
import { useAuthStore } from '@/store/auth';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Connexion par numéro de téléphone.
 *
 * Le téléphone est l'identifiant naturel ici : beaucoup de clients n'ont pas
 * d'adresse e-mail active, mais tout le monde a un numéro.
 */

// La règle de numéro vit dans le contrat partagé : la redéfinir ici l'avait
// déjà fait diverger (les espaces de saisie étaient rejetés).
const schema = z.object({
  phone: phoneSchema,
  password: z.string().min(8, 'Au moins 8 caractères'),
});

type FormValues = z.infer<typeof schema>;

export default function ConnexionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const signIn = useAuthStore((s) => s.signIn);

  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { phone: '', password: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await signIn({
        phone: values.phone,
        password: values.password,
      });
      // `replace` : revenir en arrière ne doit pas ramener à l'écran de
      // connexion une fois la session ouverte.
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
          { paddingTop: insets.top + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Icon name="wheat" size={26} color="white" />
          </View>
          <Text variant="display" color="greenDeep">
            AGRIM
          </Text>
          <Text variant="caption" color="muted">
            Développer autrement
          </Text>
        </View>

        <View style={styles.form}>
          <Text variant="h1">Connexion</Text>
          <Text variant="caption" color="muted">
            Entrez le numéro utilisé lors de votre inscription.
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
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.phone?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Mot de passe"
                placeholder="Votre mot de passe"
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.password?.message}
              />
            )}
          />

          <Button
            label={isSubmitting ? 'Connexion…' : 'Se connecter'}
            disabled={isSubmitting}
            onPress={() => void handleSubmit(onSubmit)()}
          />

          <Pressable
            onPress={() => router.push('/(auth)/inscription')}
            accessibilityRole="button"
            style={styles.switch}
          >
            <Text variant="caption" color="muted">
              Pas encore de compte ?{' '}
            </Text>
            <Text variant="caption" color="green">
              Créer un compte
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  content: {
    padding: spacing.lg,
    gap: spacing.xxl,
    paddingBottom: spacing.xxxl,
  },
  brand: { alignItems: 'center', gap: spacing.xs },
  logo: {
    width: 62,
    height: 62,
    borderRadius: radius.lg,
    backgroundColor: palette.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  form: { gap: spacing.md },
  switch: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    paddingVertical: spacing.sm,
  },
});
