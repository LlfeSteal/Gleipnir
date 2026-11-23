// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useAppearance } from '../../hooks/useAppearance';
import { AppearanceMenu } from './AppearanceMenu';

function Harness() {
  const { appearance, setAppearance } = useAppearance();
  return <AppearanceMenu appearance={appearance} onChange={setAppearance} />;
}

describe('AppearanceMenu', () => {
  it('picks the appearance in a French menu and applies it to <html>', async () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Apparence' });
    expect(button).toHaveAttribute('title', 'Apparence : Automatique');
    await userEvent.click(button);
    const menu = screen.getByRole('menu', { name: 'Apparence' });
    expect(within(menu).getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(['Automatique', 'Clair', 'Sombre']);
    expect(within(menu).getByRole('menuitemradio', { name: 'Automatique' })).toHaveFocus();
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Sombre' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('gleipnir.appearance')).toBe('dark');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    await userEvent.click(button);
    expect(screen.getByRole('menuitemradio', { name: 'Sombre' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
