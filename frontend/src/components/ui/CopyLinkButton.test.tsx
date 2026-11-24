// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CopyLinkButton } from './CopyLinkButton';

const LINK = 'http://gleipnir.interne/?lanes=a';

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

function setExecCommand(impl: () => boolean) {
  Object.defineProperty(document, 'execCommand', { value: vi.fn(impl), configurable: true, writable: true });
  return document.execCommand as unknown as ReturnType<typeof vi.fn>;
}

afterEach(() => {
  vi.useRealTimers();
  setClipboard(undefined);
});

const button = () => screen.getByRole('button', { name: 'Copier le lien' });
/** Lets the clipboard promise settle. */
const settle = () => act(async () => {});

describe('CopyLinkButton', () => {
  it('copies the link built on click, says so, then goes back to idle', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const writeText = vi.fn(async (_text: string) => {});
    setClipboard({ writeText });
    let n = 0;
    render(<CopyLinkButton link={() => `${LINK}${++n}`} />);
    expect(button()).toHaveAttribute('title', expect.stringMatching(/^Copier le lien de cette vue/));

    fireEvent.click(button());
    await settle();
    expect(writeText).toHaveBeenCalledWith(`${LINK}1`);
    expect(button()).toHaveAttribute('data-state', 'copied');
    expect(button()).toHaveAttribute('title', 'Lien copié');
    expect(button()).toHaveTextContent('Lien copié');

    act(() => vi.advanceTimersByTime(2000));
    expect(button()).toHaveAttribute('data-state', 'idle');
    expect(button()).toHaveTextContent('');
  });

  it('falls back to the copy command without the clipboard API', () => {
    setClipboard(undefined);
    const exec = setExecCommand(() => true);
    render(<CopyLinkButton link={() => LINK} />);
    fireEvent.click(button());
    expect(exec).toHaveBeenCalledWith('copy');
    expect(button()).toHaveAttribute('data-state', 'copied');
    // The hidden field is gone.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('falls back when the clipboard refuses, and says when nothing works', async () => {
    setClipboard({ writeText: vi.fn(async () => Promise.reject(new Error('denied'))) });
    setExecCommand(() => {
      throw new Error('unsupported');
    });
    render(<CopyLinkButton link={() => LINK} />);
    fireEvent.click(button());
    await settle();
    expect(button()).toHaveAttribute('data-state', 'failed');
    expect(button()).toHaveAttribute('title', 'Copie impossible : copiez l’adresse de la page');
  });

  it('says it failed when the copy command does nothing', () => {
    setExecCommand(() => false);
    render(<CopyLinkButton link={() => LINK} />);
    fireEvent.click(button());
    expect(button()).toHaveAttribute('data-state', 'failed');
  });
});
