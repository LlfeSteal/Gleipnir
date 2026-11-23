// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { BoardStats } from '../board/types';
import { SummaryLine } from './SummaryLine';

function parts(stats: BoardStats) {
  const { container } = render(<SummaryLine stats={stats} />);
  return [...container.querySelectorAll<HTMLElement>('.summary-part')];
}

describe('SummaryLine', () => {
  it('always shows epics and issues, even at zero; hides the other zeros', () => {
    const shown = parts({ lanes: 0, epics: 0, issues: 0, blocks: 0, conflicts: 0 });
    expect(shown.map((p) => p.textContent)).toEqual(['0 epic', '0 issue bloquante']);
    expect(shown.some((p) => p.dataset.alert)).toBe(false);
  });

  it('uses the singular for one', () => {
    const shown = parts({ lanes: 1, epics: 1, issues: 1, blocks: 1, conflicts: 1 });
    expect(shown.map((p) => p.textContent)).toEqual(['1 couloir', '1 epic', '1 issue bloquante', '1 blocage', '1 conflit']);
  });

  it('uses the plural above one and flags the conflicts', () => {
    const { container } = render(<SummaryLine stats={{ lanes: 4, epics: 10, issues: 9, blocks: 12, conflicts: 2 }} />);
    expect(container).toHaveTextContent('4 couloirs · 10 epics · 9 issues bloquantes · 12 blocages · 2 conflits');
    const conflicts = container.querySelector<HTMLElement>('[data-part="conflicts"]')!;
    expect(conflicts).toHaveAttribute('data-alert', 'true');
    expect(container.querySelector('[data-part="blocks"]')).not.toHaveAttribute('data-alert');
  });

  it('separators are hidden from assistive technologies', () => {
    const { container } = render(<SummaryLine stats={{ lanes: 2, epics: 3, issues: 0, blocks: 0, conflicts: 0 }} />);
    const separators = container.querySelectorAll('[aria-hidden="true"]');
    expect(separators).toHaveLength(2);
  });
});
