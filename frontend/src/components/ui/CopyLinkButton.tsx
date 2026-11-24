import { useEffect, useState } from 'react';
import { UI } from '../../strings/ui';
import { CheckIcon, LinkIcon, WarningIcon } from './Icons';

type State = 'idle' | 'copied' | 'failed';

interface Props {
  /** The link to copy, built on click: it holds the view as it is then. */
  link: () => string;
}

/** Icon button that copies a link to the clipboard; a check (or a warning) says how it went for
 * two seconds, and a live region tells screen readers. */
export function CopyLinkButton({ link }: Props) {
  const [state, setState] = useState<State>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = () => {
    const url = link();
    // The clipboard API needs a secure context (https or localhost): on plain http, the older
    // copy command.
    if (!navigator.clipboard) {
      setState(copyWithSelection(url) ? 'copied' : 'failed');
      return;
    }
    navigator.clipboard.writeText(url).then(
      () => setState('copied'),
      () => setState(copyWithSelection(url) ? 'copied' : 'failed'),
    );
  };

  const status = state === 'copied' ? UI.linkCopied : state === 'failed' ? UI.copyFailed : '';
  const Icon = state === 'copied' ? CheckIcon : state === 'failed' ? WarningIcon : LinkIcon;
  return (
    <button
      type="button"
      className="button icon"
      aria-label={UI.copyLink}
      title={status || UI.copyLinkHelp}
      data-state={state}
      onClick={copy}
    >
      <Icon size={15} />
      <span className="visually-hidden" aria-live="polite">
        {status}
      </span>
    </button>
  );
}

/** Copies through a hidden selection, for pages without the clipboard API. */
export function copyWithSelection(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.className = 'visually-hidden';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
