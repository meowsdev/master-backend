import { BadRequestException } from '@nestjs/common';

export interface PricedProblem {
  name: string;
  unitPrice: number;
  isCountable: boolean;
  maxCount: number;
}

export interface PricedOption {
  label: string;
  unitPrice: number;
  isCountable: boolean;
}

export interface PricedAnswer {
  questionText: string;
  option: PricedOption;
  count: number;
}

export interface PriceLine {
  label: string;
  unitPrice: number;
  count: number;
  amount: number;
}

export interface PriceQuote {
  lines: PriceLine[];
  total: number;
}

/**
 * Single source of truth for what an order costs. The customer app only shows
 * the result; it never sends a price.
 *
 * - A countable problem is charged per unit (2 ACs = 2 x unit price).
 * - A countable answer (e.g. "outdoor unit is hanging") is charged per affected
 *   unit, and can never exceed the number of units being serviced.
 * - Non-countable items always count as 1 and ignore any count that was sent.
 */
export function calculateQuote(
  problem: PricedProblem,
  requestedProblemCount: number,
  answers: PricedAnswer[],
): PriceQuote {
  const problemCount = problem.isCountable ? requestedProblemCount : 1;
  if (problemCount < 1 || problemCount > problem.maxCount) {
    throw new BadRequestException(
      `Count for "${problem.name}" must be between 1 and ${problem.maxCount}`,
    );
  }

  const lines: PriceLine[] = [
    line(problem.name, problem.unitPrice, problemCount),
  ];

  for (const answer of answers) {
    const count = answer.option.isCountable ? answer.count : 1;
    if (count < 1 || count > problemCount) {
      throw new BadRequestException(
        `"${answer.option.label}" count must be between 1 and ${problemCount}`,
      );
    }
    if (answer.option.unitPrice > 0) {
      lines.push(line(`${answer.questionText}: ${answer.option.label}`, answer.option.unitPrice, count));
    }
  }

  return { lines, total: lines.reduce((sum, item) => sum + item.amount, 0) };
}

function line(label: string, unitPrice: number, count: number): PriceLine {
  return { label, unitPrice, count, amount: unitPrice * count };
}


export interface PricedCartItem {
  /** Shown on the bill, e.g. "AC Check Up (1 - 2.5 Ton)". */
  name: string;
  unitPrice: number;
  isCountable: boolean;
  maxCount: number;
  quantity: number;
}

/**
 * Price of a cart: one line per chosen option (quantity applies only when it is priced per unit / sqft), then
 * the main service's follow-up answers. A countable answer can never cover more units than the cart holds.
 */
export function calculateCartQuote(items: PricedCartItem[], answers: PricedAnswer[]): PriceQuote {
  if (items.length === 0) throw new BadRequestException('Add at least one service to the cart');

  const lines: PriceLine[] = items.map((item) => {
    const count = item.isCountable ? item.quantity : 1;
    if (count < 1 || count > item.maxCount) {
      throw new BadRequestException(`Count for "${item.name}" must be between 1 and ${item.maxCount}`);
    }
    return line(item.name, item.unitPrice, count);
  });
  const totalUnits = lines.reduce((sum, item) => sum + item.count, 0);

  for (const answer of answers) {
    const count = answer.option.isCountable ? answer.count : 1;
    if (count < 1 || count > totalUnits) {
      throw new BadRequestException(`"${answer.option.label}" count must be between 1 and ${totalUnits}`);
    }
    if (answer.option.unitPrice > 0) lines.push(line(`${answer.questionText}: ${answer.option.label}`, answer.option.unitPrice, count));
  }

  return { lines, total: lines.reduce((sum, item) => sum + item.amount, 0) };
}
