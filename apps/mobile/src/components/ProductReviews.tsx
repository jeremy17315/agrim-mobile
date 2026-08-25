import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { describeError } from '@/api/errors';
import { useProductReviews, useSubmitReview } from '@/api/reviews';
import { StarRating } from '@/components/StarRating';
import { Banner, Button, Card, Icon, Input, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useIsAuthenticated } from '@/store/auth';
import { spacing } from '@/theme/tokens';

function formatNote(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

/**
 * Avis d'un produit : moyenne, liste de commentaires, et saisie
 * (étoiles à cocher + texte).
 */
export function ProductReviews({ slug }: { slug: string }) {
  const router = useRouter();
  const connected = useIsAuthenticated();
  const avis = useProductReviews(slug);
  const publier = useSubmitReview(slug);

  const [note, setNote] = useState(0);
  const [commentaire, setCommentaire] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [merci, setMerci] = useState(false);

  const envoyer = async () => {
    setErreur(null);
    setMerci(false);
    if (!connected) {
      router.push('/(auth)/connexion');
      return;
    }
    if (note < 1) {
      setErreur('Cochez une note, de 1 à 5 étoiles.');
      return;
    }
    try {
      await publier.mutateAsync({ rating: note, comment: commentaire });
      setCommentaire('');
      setNote(0);
      setMerci(true);
    } catch (error) {
      setErreur(describeError(error));
    }
  };

  const resume = avis.data;
  const liste = resume?.data ?? [];

  return (
    <View style={styles.block}>
      <Text variant="micro" color="muted">
        AVIS CLIENTS
      </Text>

      {resume && resume.count > 0 ? (
        <View style={styles.moyenne}>
          <StarRating value={Math.round(resume.average ?? 0)} size={18} />
          <Text variant="h3" color="goldDark">
            {formatNote(resume.average ?? 0)} / 5
          </Text>
          <Text variant="caption" color="muted">
            {resume.count} avis
          </Text>
        </View>
      ) : (
        <Text variant="caption" color="muted">
          Aucun avis pour le moment. Soyez le premier à noter ce riz.
        </Text>
      )}

      <Card style={styles.form}>
        <Text variant="bodyStrong">Votre note</Text>
        <StarRating value={note} onChange={setNote} interactive size={28} />
        <Input
          label="Votre commentaire"
          placeholder="Le goût, la cuisson, le rapport qualité-prix…"
          value={commentaire}
          onChangeText={setCommentaire}
          multiline
          textAlignVertical="top"
          style={styles.zone}
        />
        {erreur ? (
          <Banner
            tone="danger"
            message={erreur}
            icon={<Icon name="triangle-alert" size={14} color="danger" />}
          />
        ) : null}
        {merci ? (
          <Banner
            tone="success"
            message="Merci, votre avis est publié."
            icon={<Icon name="circle-check" size={14} color="green" />}
          />
        ) : null}
        {connected ? (
          <Button
            label={publier.isPending ? 'Publication…' : 'Publier mon avis'}
            disabled={publier.isPending}
            onPress={() => void envoyer()}
          />
        ) : (
          <Pressable
            onPress={() => router.push('/(auth)/connexion')}
            accessibilityRole="button"
          >
            <Text variant="caption" color="green" center>
              Connectez-vous pour publier un avis
            </Text>
          </Pressable>
        )}
      </Card>

      {liste.map((item) => (
        <Card key={item.id} style={styles.avis}>
          <View style={styles.avisTete}>
            <Text variant="bodyStrong">{item.authorFirstName}</Text>
            <StarRating value={item.rating} size={14} />
          </View>
          <Text variant="body" color="body">
            {item.comment}
          </Text>
          <Text variant="micro" color="muted">
            {formatDateTime(item.createdAt)}
          </Text>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: spacing.md },
  moyenne: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  form: { gap: spacing.md },
  zone: {
    minHeight: 96,
    paddingTop: spacing.md,
  },
  avis: { gap: spacing.sm },
  avisTete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
});
