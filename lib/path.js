import { WeakStackFrame } from '@bablr/weak-stack';
import { skipToDepth, buildSkips } from './utils/skip.js';
import { facades, actuals } from './facades.js';

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

  at(depth) {
    return facades.get(actuals.get(this).at(depth));
  }

  *parents(includeSelf = false) {
    if (includeSelf) yield this;
    let parent = this;
    while ((parent = parent.parent)) {
      yield parent;
    }
  }
};

export const Path = class AgastPath extends WeakStackFrame {
  static from(context, tag) {
    return Path.create(context, tag);
  }

  constructor(context, reference) {
    super();

    if (reference && reference.type !== 'ReferenceTag' && reference.type !== 'DoctypeTag') {
      throw new Error('Invalid reference for path');
    }

    this.context = context;
    this.reference = reference;

    buildSkips(this);

    new PathFacade(this);
  }

  get name() {
    return this.reference?.value.name || '[anonymous]';
  }

  get isArray() {
    return this.reference?.value.isArray || false;
  }

  at(depth) {
    return skipToDepth(depth, this);
  }

  *parents(includeSelf = false) {
    if (includeSelf) yield this;
    let parent = this;
    while ((parent = parent.parent)) {
      yield parent;
    }
  }
};
