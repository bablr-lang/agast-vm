import { Path as BasePath } from '@bablr/agast-helpers/path';

import { facades, actuals } from './facades.js';

export { allTagPathsFor, ownTagPathsFor } from '@bablr/agast-helpers/path';

export const PathFacade = class AgastPathFacade {
  constructor(path) {
    facades.set(path, this);
  }

  get reference() {
    return actuals.get(this).reference;
  }

  get parent() {
    return facades.get(actuals.get(this).parent);
  }

  get depth() {
    return actuals.get(this).depth;
  }

  get outer() {
    return actuals.get(this).outer;
  }

  get inner() {
    return actuals.get(this).inner;
  }

  get node() {
    return actuals.get(this).node;
  }

  get childrenIndex() {
    return actuals.get(this).childrenIndex;
  }

  at(depth) {
    return facades.get(actuals.get(this).at(depth));
  }

  *ancestors(includeSelf = false) {
    if (includeSelf) yield this;
    let parent = this;
    while ((parent = parent.parent)) {
      yield parent;
    }
  }
};

export class Path extends BasePath {
  static from(node) {
    return this.create(node);
  }

  constructor(parent, node, referenceIndex = null) {
    super(parent, node, referenceIndex);

    new PathFacade(this);
  }

  get value() {
    throw new Error('not implemented');
  }

  get innerRange() {
    return this.inner ? [] : null;
  }
}
