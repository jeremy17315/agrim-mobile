import { useEffect, useState } from 'react';

/**
 * Retarde la propagation d'une valeur qui change vite (champ de recherche).
 *
 * Sans cela, chaque frappe déclencherait une requête réseau : coûteux en data
 * sur un forfait compté, et inutile puisque seule la dernière compte.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
