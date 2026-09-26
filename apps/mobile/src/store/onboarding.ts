import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const ONBOARDING_KEY = 'agrim-welcome-seen-v1';

type OnboardingState = {
  hasStarted: boolean;
  hydrated: boolean;
  restore: () => Promise<void>;
  start: () => Promise<void>;
};

/** Le premier écran est mémorisé sans toucher aux données métier du panier. */
export const useOnboardingStore = create<OnboardingState>((set) => ({
  hasStarted: false,
  hydrated: false,
  restore: async () => {
    try {
      const value = await AsyncStorage.getItem(ONBOARDING_KEY);
      set({ hasStarted: value === '1', hydrated: true });
    } catch {
      // En cas de stockage indisponible, l'application reste utilisable :
      // l'accueil sera simplement reproposé au prochain lancement.
      set({ hasStarted: false, hydrated: true });
    }
  },
  start: async () => {
    set({ hasStarted: true });
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      // Le changement local est déjà appliqué ; l'échec n'empêche pas l'achat.
    }
  },
}));
