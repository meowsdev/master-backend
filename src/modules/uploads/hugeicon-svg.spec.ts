import { BadRequestException } from '@nestjs/common';
import { buildHugeiconSvg, HUGEICON_INK } from './hugeicon-svg';

const icon = [
  ['path', { d: 'M3.5 16.1L8.6 12.5', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round', key: '0' }],
  ['circle', { cx: '12', cy: '12', r: '10', stroke: 'currentColor', strokeWidth: '1.5', key: '1' }],
];

describe('buildHugeiconSvg', () => {
  it('draws the icon in the ink colour with kebab-case attributes', () => {
    const svg = buildHugeiconSvg(icon);
    expect(svg).toContain('<path d="M3.5 16.1L8.6 12.5" stroke="' + HUGEICON_INK + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>');
    expect(svg).toContain('<circle cx="12" cy="12" r="10"');
    expect(svg).not.toContain('currentColor');
    expect(svg).not.toContain('key=');
  });

  it.each([
    ['a script tag', [['script', { d: 'x' }]]],
    ['an event handler', [['path', { d: 'M0 0', onload: 'alert(1)' }]]],
    ['a link', [['path', { d: 'M0 0', href: 'javascript:alert(1)' }]]],
    ['markup inside a value', [['path', { d: 'M0 0"/><script>alert(1)</script>' }]]],
    ['a url colour', [['path', { d: 'M0 0', fill: 'url(#x)' }]]],
    ['no elements', []],
    ['not a list', 'oops'],
  ])('refuses %s', (_label, input) => {
    expect(() => buildHugeiconSvg(input)).toThrow(BadRequestException);
  });

  it('refuses an oversized icon', () => {
    expect(() => buildHugeiconSvg(Array.from({ length: 41 }, () => ['circle', { cx: '1', cy: '1', r: '1' }]))).toThrow(BadRequestException);
  });
});
