import { reifyExpressionShallow } from '@bablr/agast-vm-helpers';
import { printTerminal as printToken, getCooked, sourceTextFor } from '@bablr/agast-helpers/stream';
import { facades, actuals } from './facades.js';

export const ContextFacade = class AgastContextFacade {
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

  getProperty(node, name) {
    return actuals.get(this).getProperty(node, name);
  }

  sourceTextFor(range) {
    return actuals.get(this).sourceTextFor(range);
  }

  nodeForTag(tag) {
    return actuals.get(this).nodeForTag(tag);
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
    this.tagNodes = new WeakMap();
    this.unboxedValues = new WeakMap();
    this.facade = new ContextFacade();

    facades.set(this, this.facade);
  }

  getProperty(result, name) {
    return this.tagNodes.get(result[0] || result).properties.get(name);
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

  *ownTerminalsFor(range) {
    if (!range) return;

    const { nextTerminals, tagNodes } = this;
    let { 0: start, 1: end } = range;

    for (let term = start; term !== end; term = nextTerminals.get(term)) {
      if (term === range[0] || term === range[1]) continue;

      if (term.type === 'OpenNodeTag') {
        term = nextTerminals.get(tagNodes.get(term).endTag);
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

    const { prevTerminals, tagNodes } = this;
    let { 0: start, 1: end } = range;

    for (let term = end; term !== start; term = prevTerminals.get(term)) {
      if (term.type === 'CloseNodeTag') {
        term = prevTerminals.get(tagNodes.get(term).openTag);
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

  nodeForTag(tag) {
    return this.tagNodes.get(tag);
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
};
