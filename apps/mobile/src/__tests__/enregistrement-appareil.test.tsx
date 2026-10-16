import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { getGuestPhone } from '@/lib/installation';
import { declareGuestPhone } from '@/lib/pushDevice';
import { usePushRegistration } from '@/lib/usePushRegistration';

/**
 * Appareil et notifications poussées.
 *
 * Ce que ces tests protègent, et qui n'existait pas avant :
 *
 *  - **recevoir sans compte.** L'installation s'enregistre seule ; c'est ce qui
 *    permet de prévenir un client qui commande en invité ;
 *  - **ne pas demander l'impossible.** Serveur incapable d'envoyer
 *    (`push.enabled = false`) : aucune permission demandée, aucun
 *    enregistrement ;
 *  - **la déconnexion détache.** L'appareil ne doit plus recevoir les
 *    notifications du compte précédent ;
 *  - **un tap mène à l'écran visé**, pas systématiquement à la liste.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

const mockRegister = jest.fn(async (_input: unknown) => ({
  registered: true,
}));
const mockUnlink = jest.fn(async (_input: unknown) => ({ removed: true }));
const mockUpdate = jest.fn(async (_input: unknown) => ({ updated: true }));

jest.mock('@/api/notifications', () => ({
  registerPushDevice: (input: unknown) => mockRegister(input),
  unlinkPushDevice: (input: unknown) => mockUnlink(input),
  updatePushDevice: (input: unknown) => mockUpdate(input),
}));

let mockPushEnabled = true;
jest.mock('@/api/config', () => ({
  useAppConfig: () => ({ data: { push: { enabled: mockPushEnabled } } }),
}));

let mockUserId: string | null = null;
jest.mock('@/store/auth', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: mockUserId ? { id: mockUserId } : null }),
}));

/** Un appareil réel, avec une permission accordée et un projet EAS. */
const notificationsMock = {
  listener: null as null | ((response: unknown) => void),
};

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: (
    listener: (response: unknown) => void,
  ) => {
    notificationsMock.listener = listener;
    return { remove: jest.fn() };
  },
  getLastNotificationResponseAsync: jest.fn(async () => null),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({
    status: 'granted',
    canAskAgain: true,
  })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({
    data: 'ExponentPushToken[essai]',
  })),
  AndroidImportance: { DEFAULT: 3 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
}));

jest.mock('expo-device', () => ({ isDevice: true }));

// `jest.setup.js` fournit une configuration Expo minimale, sans projet EAS :
// sans identifiant de projet, aucun jeton ne peut être obtenu.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { eas: { projectId: 'projet-essai' } } },
    easConfig: { projectId: 'projet-essai' },
  },
}));

beforeEach(async () => {
  jest.clearAllMocks();
  notificationsMock.listener = null;
  mockPushEnabled = true;
  mockUserId = null;
  await AsyncStorage.clear();
});

it('enregistre l’appareil d’un invité, sans compte', async () => {
  renderHook(() => usePushRegistration());

  await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
  const enregistrement = mockRegister.mock.calls[0]![0] as {
    installationId: string;
    token: string;
    platform: string;
  };

  expect(enregistrement.token).toBe('ExponentPushToken[essai]');
  // L'identifiant d'installation est Fabriqué sur l'appareil, jamais dérivé
  // d'un compte : c'est lui qui identifie un invité.
  expect(enregistrement.installationId).toMatch(/^[a-z0-9]{32}$/);
  expect(enregistrement.platform).toBe('ios');
});

it('ne demande rien quand le serveur ne peut pas envoyer', async () => {
  mockPushEnabled = false;

  renderHook(() => usePushRegistration());
  await act(async () => {
    await Promise.resolve();
  });

  expect(mockRegister).not.toHaveBeenCalled();
});

it('détache l’appareil quand le client se déconnecte', async () => {
  mockUserId = 'user-1';
  const view = renderHook(() => usePushRegistration());
  await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));

  mockUserId = null;
  // `renderHook` exige les propriétés de rappel : le hook n'en prend aucune,
  // on relance donc le rendu à l'identique.
  view.rerender(undefined);

  await waitFor(() => expect(mockUnlink).toHaveBeenCalledTimes(1));
  expect(mockUnlink).toHaveBeenCalledWith({
    installationId: expect.any(String),
    token: 'ExponentPushToken[essai]',
  });
});

it('déclare le numéro d’un invité sur son appareil', async () => {
  await declareGuestPhone('0700000001');

  expect(mockUpdate).toHaveBeenCalledWith({
    installationId: expect.stringMatching(/^[a-z0-9]{32}$/),
    phone: '0700000001',
  });
  // Conservé : l'enregistrement suivant le renverra sans que le client ait à
  // le ressaisir.
  expect(await getGuestPhone()).toBe('0700000001');
});

it('ouvre la destination enregistrée par le serveur au tap', async () => {
  renderHook(() => usePushRegistration());
  await waitFor(() => expect(notificationsMock.listener).not.toBeNull());

  act(() => {
    notificationsMock.listener?.({
      notification: {
        request: {
          identifier: 'notification-1',
          content: { data: { target: 'categorie', value: 'cereales' } },
        },
      },
    });
  });

  expect(mockPush).toHaveBeenCalledWith('/catalogue?category=cereales');
});

it('ouvre la commande d’une notification ancienne, sans destination', async () => {
  renderHook(() => usePushRegistration());
  await waitFor(() => expect(notificationsMock.listener).not.toBeNull());

  act(() => {
    notificationsMock.listener?.({
      notification: {
        request: {
          identifier: 'notification-2',
          content: { data: { reference: 'AGR-2026-0042' } },
        },
      },
    });
  });

  expect(mockPush).toHaveBeenCalledWith('/commandes/AGR-2026-0042');
});

it('ne mène nulle part plutôt que deux fois pour la même notification', async () => {
  renderHook(() => usePushRegistration());
  await waitFor(() => expect(notificationsMock.listener).not.toBeNull());

  const response = {
    notification: {
      request: {
        identifier: 'notification-3',
        content: { data: { target: 'commande', value: 'AGR-2026-0042' } },
      },
    },
  };

  act(() => notificationsMock.listener?.(response));
  act(() => notificationsMock.listener?.(response));

  expect(mockPush).toHaveBeenCalledTimes(1);
});
