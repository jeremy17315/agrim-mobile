import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  Image,
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
import { palette, spacing } from '@/theme/tokens';

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
        {/* Le logo officiel AGRIM, tel que fourni par la marque : l'épi, le
            lettrage et la signature y figurent déjà, on ne les réécrit donc
            pas en texte à côté. Aucun habillage ajouté (pas de carré vert,
            pas d'icône générique) — c'est le visuel de la marque. */}
        <View style={styles.brand}>
          <Image
            source={require('../../assets/logo-agrim.png')}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="Logo AGRIM"
          />
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
            onPress={() => router.push('/(auth)/mot-de-passe-oublie')}
            accessibilityRole="button"
            style={styles.switch}
          >
            <Text variant="caption" color="green">
              Mot de passe oublié ?
            </Text>
          </Pressable>

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
  brand: { alignItems: 'center' },
  // Rapport 3,02 conservé (1200 × 398) : le logo n'est jamais déformé.
  logo: {
    width: 212,
    height: 70,
  },
  form: { gap: spacing.md },
  switch: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    paddingVertical: spacing.sm,
  },
});
