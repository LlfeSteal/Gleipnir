// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorBanner, Skeleton } from './StateViews';

describe('StateViews', () => {
  it('shows a busy skeleton while loading', () => {
    render(<Skeleton />);
    expect(screen.getByRole('status', { name: 'Chargement…' })).toHaveAttribute('aria-busy', 'true');
  });

  it('reports an error as an alert, with Réessayer when it can retry', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorBanner title="Jeton invalide" message="GitLab a refusé le jeton." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Jeton invalideGitLab a refusé le jeton.');
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRetry).toHaveBeenCalled();
    rerender(<ErrorBanner title="Jeton invalide" message="GitLab a refusé le jeton." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows an empty state with its action', () => {
    render(<EmptyState title="Aucun couloir" message="Créez un couloir." action={<button type="button">Nouveau couloir</button>} />);
    expect(screen.getByText('Aucun couloir')).toBeInTheDocument();
    expect(screen.getByText('Créez un couloir.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nouveau couloir' })).toBeInTheDocument();
  });
});
