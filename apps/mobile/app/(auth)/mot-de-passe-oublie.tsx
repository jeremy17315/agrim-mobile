import { phoneSchema } from '@agrim/contracts';
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

import { requestPasswordReset, resetPassword } from '@/api/auth';
import { describeError } from '@/api/errors';
import { Banner, Button, Icon, Input, Text } from '@/components/ui';
import { palette, spacing } from '@/theme/tokens';

const demandeSchema = z.object({ phone: phoneSchema });

const resetSchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, 'Le code comporte 6 chiffres.'),
  password: z
    .string()
    .min(8, 'Au moins 8 caractères')
    .regex(/[A-Za-z]/, 'Doit contenir une lettre')
    .regex(/[0-9]/, 'Doit contenir un chiffre'),
});

type DemandeValues = z.infer<typeof demandeSchema>;
type ResetValues = z.infer<typeof resetSchema>;

/**
 * Réinitialisation en deux temps, sans jamais révéler si le numéro existe.
 */
export default function MotDePasseOublieScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [etape, setEtape] = useState<'demande' | 'code'>('demande');
  const [phone, setPhone] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const demande = useForm<DemandeValues>({
    resolver: zodResolver(demandeSchema),
    defaultValues: { phone: '' },
  });
  const reset = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { phone: '', code: '', password: '' },
  });

  const envoyerCode = async (values: DemandeValues) => {
    setErreur(null);
    try {
      await requestPasswordReset(values.phone);
      setPhone(values.phone);
      reset.setValue('phone', values.phone);
      setInfo('Si ce numéro a un compte, un code SMS vient de partir.');
      setEtape('code');
    } catch (error) {
      setErreur(describeError(error));
    }
  };

  const appliquer = async (values: ResetValues) => {
    setErreur(null);
    try {
      await resetPassword(values);
      router.replace('/(auth)/connexion');
    } catch (error) {
      setErreur(describeError(error));
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
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          hitSlop={12}
          style={styles.back}
        >
          <Icon name="arrow-left" size={19} color="ink" />
        </Pressable>

        <Text variant="h1">Mot de passe oublié</Text>
        <Text variant="caption" color="muted">
          {etape === 'demande'
            ? 'Indiquez le numéro de votre compte. Un code à 6 chiffres vous sera envoyé par SMS.'
            : `Saisissez le code reçu au ${phone} et choisissez un nouveau mot de passe.`}
        </Text>

        {erreur ? (
          <Banner
            tone="danger"
            message={erreur}
            icon={<Icon name="triangle-alert" size={14} color="danger" />}
          />
        ) : null}
        {info ? (
          <Banner
            tone="success"
            message={info}
            icon={<Icon name="circle-check" size={14} color="green" />}
          />
        ) : null}

        {etape === 'demande' ? (
          <View style={styles.form}>
            <Controller
              control={demande.control}
              name="phone"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Numéro de téléphone"
                  placeholder="07 00 00 00 01"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={demande.formState.errors.phone?.message}
                />
              )}
            />
            <Button
              label={
                demande.formState.isSubmitting ? 'Envoi…' : 'Recevoir le code'
              }
              disabled={demande.formState.isSubmitting}
              onPress={() => void demande.handleSubmit(envoyerCode)()}
            />
          </View>
        ) : (
          <View style={styles.form}>
            <Controller
              control={reset.control}
              name="code"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Code reçu par SMS"
                  placeholder="482917"
                  keyboardType="number-pad"
                  maxLength={6}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={reset.formState.errors.code?.message}
                />
              )}
            />
            <Controller
              control={reset.control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <Input
                  label="Nouveau mot de passe"
                  placeholder="Au moins 8 caractères"
                  secureTextEntry
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={reset.formState.errors.password?.message}
                />
              )}
            />
            <Button
              label={
                reset.formState.isSubmitting
                  ? 'Enregistrement…'
                  : 'Changer le mot de passe'
              }
              disabled={reset.formState.isSubmitting}
              onPress={() => void reset.handleSubmit(appliquer)()}
            />
            <Pressable
              onPress={() => {
                setInfo(null);
                setErreur(null);
                setEtape('demande');
              }}
              accessibilityRole="button"
            >
              <Text variant="caption" color="green" center>
                Renvoyer un code
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  back: { alignSelf: 'flex-start', paddingBottom: spacing.sm },
  form: { gap: spacing.md, marginTop: spacing.sm },
});
