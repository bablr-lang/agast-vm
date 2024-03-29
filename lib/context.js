import { reifyExpressionShallow } from '@bablr/agast-vm-helpers';
import { printTerminal as printToken, getCooked, sourceTextFor } from '@bablr/agast-helpers/stream';
import { facades, actuals } from './facades.js';

export class ContextFacade {
  getInnerText(range) {
    return actuals.get(this).getInnerText(range);
  }

  getPreviousTerminal(token) {
    return actuals.get(this).prevTerminals.get(token);
  }

  getNextTerminal(token) {
    return actuals.get(this).nextTerminals.get(token);
  }

  ownTerminalsFor(range) {
    return actuals.get(this).ownTerminalsFor(range);
  }

  allTerminalsFor(range) {
    return actuals.get(this).allTerminalsFor(range);
  }

  getCooked(range) {
    return actuals.get(this).getCooked(range);
  }

  sourceTextFor(range) {
    return actuals.get(this).sourceTextFor(range);
  }

  unbox(value) {
    return actuals.get(this).unbox(value);
  }
}

export class Context {
  static create() {
    return new Context();
  }

  constructor() {
    this.prevTerminals = new WeakMap();
    this.nextTerminals = new WeakMap();
    this.tagPaths = new WeakMap();
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

  getInnerText(range) {
    let text = '';
    for (const terminal of this.allTerminalsFor(range)) {
      if (terminal.type === 'Literal') {
        text += printToken(terminal);
      }
    }
    return text;
  }

  *ownTerminalsFor(range) {
    if (!range) return;

    const { nextTerminals, tagPairs } = this;
    let { 0: start, 1: end } = range;

    for (let term = start; term !== end; term = nextTerminals.get(term)) {
      if (term.type === 'OpenNodeTag') {
        term = nextTerminals.get(tagPairs.get(term));
      }

      yield term;
    }
  }

  *allTerminalsFor(range) {
    if (!range) return;

    const { nextTerminals } = this;
    let { 0: start, 1: end } = range;

    for (let tag = start; tag !== end; tag = nextTerminals.get(tag)) {
      yield tag;
    }
  }

  *ownTerminalsReverseFor(range) {
    if (!range) return;

    const { prevTerminals, tagPairs } = this;
    let { 0: start, 1: end } = range;

    for (let term = end; term !== start; term = prevTerminals.get(term)) {
      if (term.type === 'CloseNodeTag') {
        term = prevTerminals.get(tagPairs.get(term));
      }

      yield term;
    }
  }

  *allTerminalsReverseFor(range) {
    if (!range) return;

    const { prevTerminals } = this;
    let { 0: start, 1: end } = range;

    for (let tag = end; tag !== start; tag = prevTerminals.get(tag)) {
      yield tag;
    }
  }

  sourceTextFor(range) {
    return sourceTextFor(this.allTerminalsFor(range));
  }

  unbox(value) {
    const { unboxedValues } = this;
    if (!unboxedValues.has(value)) {
      unboxedValues.set(value, reifyExpressionShallow(value));
    }

    return unboxedValues.get(value);
  }

  getCooked(range) {
    return getCooked(this.ownTerminalsFor(range));
  }
}
