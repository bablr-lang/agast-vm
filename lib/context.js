import { reifyExpressionShallow, reifyExpression } from '@bablr/agast-vm-helpers';
import { getCooked, sourceTextFor } from '@bablr/agast-helpers/stream';
import { facades, actuals } from './facades.js';

function* ownTerminalsFor(range, nextTerminals, tagNodes) {
  if (!range) return;

  const { 0: start, 1: end } = range;

  const pastEnd = nextTerminals.get(end);

  for (let term = start; term && term !== pastEnd; term = nextTerminals.get(term)) {
    if (!(term === range[0] || term === range[1]) && term.type === 'OpenNodeTag') {
      term = nextTerminals.get(tagNodes.get(term).endTag);
    }

    yield term;
  }
}

function* allTerminalsFor(range, nextTerminals) {
  if (!range) return;
  const { 0: start, 1: end } = range;

  const pastEnd = nextTerminals.get(end);

  for (let tag = start; tag !== pastEnd; tag = nextTerminals.get(tag)) {
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

  ownTerminalsFor(range) {
    return actuals.get(this).ownTerminalsFor(range);
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

  getProperty(node, name) {
    return actuals.get(this).getProperty(node, name);
  }

  sourceTextFor(range) {
    return actuals.get(this).sourceTextFor(range);
  }

  buildRange(terminals) {
    return actuals.get(this).buildRange(terminals);
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

  allTerminalsFor(range) {
    return allTerminalsFor(range, this.nextTerminals);
  }

  allTerminalsReverseFor(range) {
    return allTerminalsFor(range, this.prevTerminals);
  }

  ownTerminalsFor(range) {
    return ownTerminalsFor(range, this.nextTerminals, this.tagNodes);
  }

  ownTerminalsReverseFor(range) {
    return ownTerminalsFor(range, this.prevTerminals, this.tagNodes);
  }

  nodeForTag(tag) {
    return this.tagNodes.get(tag);
  }

  sourceTextFor(range) {
    return sourceTextFor(this.allTerminalsFor(range));
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

  getCooked(range) {
    return getCooked(this.ownTerminalsFor(range));
  }
};
