import { BadRequestException } from '@nestjs/common';

/** The picture colour of a chosen icon. Hugeicons are drawn in `currentColor`, which means nothing in a file. */
export const HUGEICON_INK = '#202939';

type Element = [string, Record<string, unknown>];

const MAX_ELEMENTS = 40;
const TAGS = ['path', 'circle', 'ellipse', 'rect'];
const NUMBER = /^-?\d+(\.\d+)?$/;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]{1,6000}$/;
const TRANSFORM = /^([a-z]+\([0-9eE.,\s+-]+\)\s*)+$/;
const COLOR = /^(currentColor|none|#[0-9a-fA-F]{3,8})$/;

/** attribute name in the icon data -> [SVG attribute, check on its value]. Anything else is refused. */
const ATTRIBUTES: Record<string, [string, (value: string) => boolean]> = {
  d: ['d', (value) => PATH_DATA.test(value)],
  cx: ['cx', (value) => NUMBER.test(value)],
  cy: ['cy', (value) => NUMBER.test(value)],
  r: ['r', (value) => NUMBER.test(value)],
  rx: ['rx', (value) => NUMBER.test(value)],
  ry: ['ry', (value) => NUMBER.test(value)],
  x: ['x', (value) => NUMBER.test(value)],
  y: ['y', (value) => NUMBER.test(value)],
  width: ['width', (value) => NUMBER.test(value)],
  height: ['height', (value) => NUMBER.test(value)],
  opacity: ['opacity', (value) => NUMBER.test(value)],
  fill: ['fill', (value) => COLOR.test(value)],
  stroke: ['stroke', (value) => COLOR.test(value)],
  strokeWidth: ['stroke-width', (value) => NUMBER.test(value)],
  strokeLinecap: ['stroke-linecap', (value) => ['butt', 'round', 'square'].includes(value)],
  strokeLinejoin: ['stroke-linejoin', (value) => ['miter', 'round', 'bevel'].includes(value)],
  fillRule: ['fill-rule', (value) => ['evenodd', 'nonzero'].includes(value)],
  clipRule: ['clip-rule', (value) => ['evenodd', 'nonzero'].includes(value)],
  transform: ['transform', (value) => TRANSFORM.test(value)],
};

/**
 * Builds an SVG file from the element list of a Hugeicons icon (the same data the icon library ships).
 * The browser only sends data; the markup is written here, from a whitelist of shapes and attributes with
 * checked values, so a stored picture can never carry script, links or event handlers.
 */
export function buildHugeiconSvg(elements: unknown): string {
  if (!Array.isArray(elements) || elements.length === 0 || elements.length > MAX_ELEMENTS) {
    throw new BadRequestException('Invalid icon');
  }

  const shapes = (elements as Element[]).map((element) => {
    const [tag, attributes] = Array.isArray(element) ? element : [undefined, undefined];
    if (typeof tag !== 'string' || !TAGS.includes(tag) || typeof attributes !== 'object' || attributes === null) {
      throw new BadRequestException('Invalid icon');
    }

    const written = Object.entries(attributes).flatMap(([name, rawValue]) => {
      if (name === 'key') return []; // React bookkeeping, not part of the drawing
      const rule = ATTRIBUTES[name];
      const value = String(rawValue);
      if (!rule || !rule[1](value)) throw new BadRequestException('Invalid icon');
      const finalValue = value === 'currentColor' ? HUGEICON_INK : value;
      return [`${rule[0]}="${finalValue}"`];
    });
    return `<${tag} ${written.join(' ')}/>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none">${shapes.join('')}</svg>`;
}
