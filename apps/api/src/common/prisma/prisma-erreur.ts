/**
 * Reconnaissance STRUCTURELLE d'une violation d'unicité Prisma.
 *
 * Pourquoi pas `instanceof PrismaClientKnownRequestError` : l'identité de
 * classe ne survit pas aux copies multiples du client généré — mock de
 * test, mono-répo, montée de version — et l'erreur est alors relancée
 * brute au lieu d'être traduite en erreur métier. C'est la marque `code`
 * qui est stable : toute erreur Prisma « connue » la porte, quelle que
 * soit la copie qui l'a produite.
 */
export function estP2002(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
