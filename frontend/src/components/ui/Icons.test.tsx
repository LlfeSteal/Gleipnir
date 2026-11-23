// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { ComponentType } from 'react';
import * as Icons from './Icons';

const icons = Object.entries(Icons).filter(([name]) => name.endsWith('Icon')) as [string, ComponentType<Icons.IconProps>][];

describe('Icons', () => {
  it('exports icons', () => {
    expect(icons.length).toBeGreaterThan(20);
  });

  it.each(icons)('%s is a decorative SVG of the given size', (_name, Icon) => {
    const { container } = render(<Icon size={20} className="x" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveClass('x');
    expect(svg.childElementCount).toBeGreaterThan(0);
  });

  it.each(icons)('%s defaults to 16 px', (_name, Icon) => {
    const { container } = render(<Icon />);
    expect(container.querySelector('svg')).toHaveAttribute('height', '16');
  });
});
