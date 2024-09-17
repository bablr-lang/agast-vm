import { reifyExpressionShallow, reifyExpression } from '@bablr/agast-vm-helpers';
import {
  getCooked as getCookedFromTree,
  sourceTextFor as sourceTextForTree,
} from '@bablr/agast-helpers/tree';
import {
  getCooked as getCookedFromStream,
  sourceTextFor as sourceTextForStream,
} from '@bablr/agast-helpers/stream';
import { OpenNodeTag, CloseNodeTag } from '@bablr/agast-helpers/symbols';
import { facades, actuals } from './facades.js';

const { isArray } = Array;

function* allTagsFor(range, nextTags) {
  if (!range) return;
  const { 0: start, 1: end } = range;

  const pastEnd = nextTags.get(end);

  for (let tag = start; tag && tag !== pastEnd; tag = nextTags.get(tag)) {
    yield tag;
  }
}

export const ContextFacade = class AgastContextFacade {
  getPreviousTag(token) {
    return actuals.get(this).prevTags.get(token);
  }

  getNextTag(token) {
    return actuals.get(this).nextTags.get(token);
  }

  allTagsFor(range) {
    return actuals.get(this).allTagsFor(range);
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

  buildRange(tags) {
    return actuals.get(this).buildRange(tags);
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
    this.prevTags = new WeakMap();
    this.nextTags = new WeakMap();
    this.unboxedValues = new WeakMap();
    this.facade = new ContextFacade();

    facades.set(this, this.facade);
  }

  isEmpty(range) {
    const { path, parent } = this;

    if (range[0]?.type === OpenNodeTag && path !== parent.path) {
      const nextTag = this.nextTags.get(range[0]);
      if (!nextTag || nextTag.type === CloseNodeTag) {
        return null;
      }
    } else {
      return range[0] === range[1];
    }
  }

  allTagsFor(range) {
    return allTagsFor(range, this.nextTags);
  }

  allTagsReverseFor(range) {
    return allTagsFor([...range].reverse(), this.prevTags);
  }

  getPreviousTag(token) {
    return this.prevTags.get(token);
  }

  getNextTag(token) {
    return this.nextTags.get(token);
  }

  sourceTextFor(nodeOrRange) {
    return isArray(nodeOrRange)
      ? sourceTextForStream(this.allTagsFor(nodeOrRange))
      : sourceTextForTree(nodeOrRange);
  }

  buildRange(tags) {
    const { prevTags, nextTags } = this;

    let start, end;
    for (const tag of tags) {
      if (prevTags.has(tag) || nextTags.has(tag)) {
        throw new Error('buildRange must not overwrite linkages');
      }

      if (end) {
        prevTags.set(tag, end);
        nextTags.set(end, tag);
      }

      start = start || tag;
      end = tag || end;
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
      ? getCookedFromStream(this.allTagsFor(nodeOrRange))
      : getCookedFromTree(nodeOrRange);
  }
};
