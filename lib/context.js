import { reifyExpression } from '@bablr/agast-vm-helpers';
import { sourceTextFor as sourceTextForTree } from '@bablr/agast-helpers/tree';

import { allTagPathsFor } from './path.js';
import { facades, actuals } from './facades.js';

export const ContextFacade = class AgastContextFacade {
  getPreviousTagPath(token) {
    return actuals.get(this).prevTags.get(token);
  }

  getNextTagPath(token) {
    return actuals.get(this).nextTags.get(token);
  }

  allTagsFor(range) {
    return actuals.get(this).allTagsFor(range);
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

  nodeForTag(tag) {
    return actuals.get(this).nodeForTag(tag);
  }
};

export const Context = class AgastContext {
  static create() {
    return new Context();
  }

  constructor() {
    this.tagNodes = new WeakMap();
    this.facade = new ContextFacade();

    facades.set(this, this.facade);
  }

  allTagsFor(range) {
    return allTagPathsFor(range);
  }

  allTagsReverseFor(range) {
    throw new Error('not implemented');
  }

  nodeForTag(tag) {
    return this.tagNodes.get(tag);
  }

  sourceTextFor(node) {
    return sourceTextForTree(node);
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

  reifyExpression(value) {
    return reifyExpression(value);
  }
};
