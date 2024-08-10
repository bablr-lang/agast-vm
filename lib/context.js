import { reifyExpressionShallow, reifyExpression } from '@bablr/agast-vm-helpers';
import {
  getCooked as getCookedFromTree,
  sourceTextFor as sourceTextForTree,
} from '@bablr/agast-helpers/tree';
import {
  getCooked as getCookedFromStream,
  sourceTextFor as sourceTextForStream,
} from '@bablr/agast-helpers/stream';
import { facades, actuals } from './facades.js';

const { isArray } = Array;

function* allTerminalsFor(range, nextTerminals) {
  if (!range) return;
  const { 0: start, 1: end } = range;

  const pastEnd = nextTerminals.get(end);

  for (let tag = start; tag && tag !== pastEnd; tag = nextTerminals.get(tag)) {
    yield tag;
  }
}

export const ContextFacade = class AgastContextFacade {
  getPreviousTerminal(token) {
    return actuals.get(this).prevTerminals.get(token);
  }

  getNextTerminal(token) {
    return actuals.get(this).nextTerminals.get(token);
  }

  allTerminalsFor(range) {
    return actuals.get(this).allTerminalsFor(range);
  }

  getCooked(range) {
    return actuals.get(this).getCooked(range);
  }

  reifyExpression(range) {
    return actuals.get(this).reifyExpression(range);
  }

  sourceTextFor(range) {
    return actuals.get(this).sourceTextFor(range);
  }

  buildRange(terminals) {
    return actuals.get(this).buildRange(terminals);
  }

  unbox(value) {
    return actuals.get(this).unbox(value);
  }
};

export const Context = class AgastContext {
  static create() {
    return new Context();
  }

  constructor() {
    this.prevTerminals = new WeakMap();
    this.nextTerminals = new WeakMap();
    this.unboxedValues = new WeakMap();
    this.facade = new ContextFacade();

    facades.set(this, this.facade);
  }

  isEmpty(range) {
    const { path, parent } = this;

    if (range[0]?.type === 'OpenNodeTag' && path !== parent.path) {
      const nextTag = this.nextTerminals.get(range[0]);
      if (!nextTag || nextTag.type === 'CloseNodeTag') {
        return null;
      }
    } else {
      return range[0] === range[1];
    }
  }

  allTerminalsFor(range) {
    return allTerminalsFor(range, this.nextTerminals);
  }

  allTerminalsReverseFor(range) {
    return allTerminalsFor([...range].reverse(), this.prevTerminals);
  }

  getPreviousTerminal(token) {
    return this.prevTerminals.get(token);
  }

  getNextTerminal(token) {
    return this.nextTerminals.get(token);
  }

  sourceTextFor(nodeOrRange) {
    return isArray(nodeOrRange)
      ? sourceTextForStream(this.allTerminalsFor(nodeOrRange))
      : sourceTextForTree(nodeOrRange);
  }

  buildRange(terminals) {
    const { prevTerminals, nextTerminals } = this;

    let start, end;
    for (const terminal of terminals) {
      if (prevTerminals.has(terminal) || nextTerminals.has(terminal)) {
        throw new Error('buildRange must not overwrite linkages');
      }

      if (end) {
        prevTerminals.set(terminal, end);
        nextTerminals.set(end, terminal);
      }

      start = start || terminal;
      end = terminal || end;
    }
    return start ? [start, end] : null;
  }

  unbox(value) {
    const { unboxedValues } = this;
    if (!unboxedValues.has(value)) {
      unboxedValues.set(value, reifyExpressionShallow(value));
    }

    return unboxedValues.get(value);
  }

  reifyExpression(value) {
    return reifyExpression(value);
  }

  getCooked(nodeOrRange) {
    return isArray(nodeOrRange)
      ? getCookedFromStream(this.allTerminalsFor(nodeOrRange))
      : getCookedFromTree(nodeOrRange);
  }
};
