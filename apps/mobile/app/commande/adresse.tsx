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

import { describeError } from '@/api/errors';
import { useCreateAddress } from '@/api/orders';
import { Banner, Button, Icon, Input, Text } from '@/components/ui';
import { palette, spacing } from '@/theme/tokens';

/**
 * Saisie d'une adresse de livraison.
 *
 * En Côte d'Ivoire, le numéro de rue n'existe souvent pas : c'est le POINT DE
 * REPÈRE qui permet réellement au livreur de trouver. Il est donc mis en avant
 * et fortement encouragé, même s'il n'est pas techniquement obligatoire.
 */

const schema = z.object({
  label: z.string().trim().min(1, 'Donnez un nom à cette adresse').max(60),
  city: z.string().trim().min(1, 'Ville requise').max(80),
  commune: z.string().trim().max(80).optional(),
  district: z.string().trim().max(120).optional(),
  landmark: z.string().trim().max(255).optional(),
  instructions: z.string().trim().max(500).optional(),
  contactPhone: z
    .string()
    .trim()
    .regex(/^(\+225)?\s?[0-9]{10}$/, 'Numéro ivoirien à 10 chiffres'),
});

type FormValues = z.infer<typeof schema>;

export default function AdresseScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const createAddress = useCreateAddress();

  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      label: '',
      city: '',
      commune: '',
      district: '',
      landmark: '',
      instructions: '',
      contactPhone: '',
    },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await createAddress.mutateAsync({
        label: values.label,
        city: values.city,
        contactPhone: values.contactPhone.replace(/\s/g, ''),
        // Les champs vides ne sont pas envoyés : le serveur les stockera nuls.
        ...(values.commune ? { commune: values.commune } : {}),
        ...(values.district ? { district: values.district } : {}),
        ...(values.landmark ? { landmark: values.landmark } : {}),
        ...(values.instructions ? { instructions: values.instructions } : {}),
      });
      router.back();
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
          { paddingTop: insets.top + spacing.md },
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
          <Text variant="h3">Nouvelle adresse</Text>
        </View>

        <View style={styles.form}>
          {submitError ? (
            <Banner
              tone="danger"
              message={submitError}
              icon={<Icon name="triangle-alert" size={14} color="danger" />}
            />
          ) : null}

          <Controller
            control={control}
            name="label"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Nom de l’adresse"
                placeholder="Maison, Bureau…"
                required
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.label?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="city"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Ville"
                placeholder="Yamoussoukro"
                required
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.city?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="commune"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Commune"
                placeholder="Habitat"
                value={value ?? ''}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.commune?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="district"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Quartier"
                placeholder="Quartier Millionnaire"
                value={value ?? ''}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.district?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="landmark"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Point de repère"
                placeholder="En face de la pharmacie du Rond-point"
                hint="Le plus utile pour que le livreur vous trouve"
                value={value ?? ''}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.landmark?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="contactPhone"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Téléphone du destinataire"
                placeholder="07 00 00 00 01"
                required
                keyboardType="phone-pad"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.contactPhone?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="instructions"
            render={({ field: { onChange, onBlur, value } }) => (
              <Input
                label="Instructions de livraison"
                placeholder="Portail vert, appeler en arrivant"
                multiline
                numberOfLines={3}
                style={styles.textarea}
                value={value ?? ''}
                onChangeText={onChange}
                onBlur={onBlur}
                error={errors.instructions?.message}
              />
            )}
          />

          <Button
            label={isSubmitting ? 'Enregistrement…' : 'Enregistrer l’adresse'}
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
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  form: { gap: spacing.md },
  textarea: { minHeight: 84, paddingTop: spacing.md, textAlignVertical: 'top' },
});
