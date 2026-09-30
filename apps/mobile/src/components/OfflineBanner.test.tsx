import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { OfflineBanner } from './OfflineBanner';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

beforeEach(() => {
  onlineManager.setOnline(true);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

afterEach(() => {
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});

it('ne gêne pas la navigation lorsque le téléphone est connecté', () => {
  render(<OfflineBanner />);

  expect(screen.queryByText('Bélier d’Or')).toBeNull();
});

it('explique le mode hors connexion et compose le contact AGRIM', () => {
  act(() => {
    onlineManager.setOnline(false);
  });
  render(<OfflineBanner />);

  expect(screen.getByText('Bélier d’Or')).toBeTruthy();
  expect(screen.getByText(/Pas de connexion Internet/i)).toBeTruthy();

  fireEvent.press(screen.getByLabelText('APPELER'));
  expect(Linking.openURL).toHaveBeenCalledWith('tel:+2250700050452');
});
