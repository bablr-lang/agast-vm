import { WeakStackFrame } from '@bablr/weak-stack';
import { Resolver } from '@bablr/agast-helpers/tree';
import { findRight } from './utils/array.js';
import { facades, actuals } from './facades.js';

const skipLevels = 3;
const skipShiftExponentGrowth = 4;
const skipAmounts = new Array(skipLevels)
  .fill(null)
  .map((_, i) => 2 >> (i * skipShiftExponentGrowth));
const skipsByPath = new WeakMap();

export const NodeFacade = class AgastNodeFacade {
  constructor(path) {
    facades.set(path, this);
  }

  get language() {
    return actuals.get(this).language;
  }

  get type() {
    return actuals.get(this).type;
  }

  get path() {
    return actuals.get(this).path;
  }

  get parent() {
    return facades.get(actuals.get(this).parent);
  }

  get range() {
    return actuals.get(this).range;
  }

  get openTag() {
    return actuals.get(this).openTag;
  }

  get closeTag() {
    return actuals.get(this).closeTag;
  }

  get depth() {
    return actuals.get(this).depth;
  }

  get flags() {
    return actuals.get(this).flags;
  }

  get attributes() {
    return actuals.get(this).attributes;
  }
};

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
    let parent = this;

    if (depth > this.depth) throw new Error();

    let d = actuals.get(parent).depth;
    for (; d > depth; ) {
      const skips = skipsByPath.get(actuals.get(this));
      parent = (skips && findRight(skips, (skip) => d - skip > depth)) || parent.parent;
      d = actuals.get(parent).depth;
    }
    return parent;
  }

  *parents(includeSelf = false) {
    if (includeSelf) yield this;
    let parent = this;
    while ((parent = parent.parent)) {
      yield parent;
    }
  }
};

export const Node = class AgastNode extends WeakStackFrame {
  static from(path, openTag) {
    return AgastNode.create(path, openTag);
  }

  constructor(
    path,
    openTag,
    closeTag = null,
    properties = new Map(),
    resolver = new Resolver(),
    unboundAttributes = null,
  ) {
    super();

    this.path = path;
    this.openTag = openTag;
    this.closeTag = closeTag;
    this.properties = properties;
    this.resolver = resolver;
    this.unboundAttributes = unboundAttributes;
  }

  get context() {
    return this.path.context;
  }

  get language() {
    return this.openTag.value?.language;
  }

  get type() {
    return this.openTag.value?.type || Symbol.for('@bablr/fragment');
  }

  get flags() {
    return this.openTag.value?.flags || {};
  }

  get attributes() {
    return this.openTag.value?.attributes || {};
  }

  branch() {
    const { path, openTag, closeTag, properties, resolver, unboundAttributes } = this;

    return this.push(
      path,
      openTag,
      closeTag,
      new Map(properties), // there is probably a better way
      resolver.branch(),
      new Set(unboundAttributes),
    );
  }

  accept(node) {
    this.openTag = node.openTag;
    this.closeTag = node.closeTag;
    this.properties = node.properties;
    this.unboundAttributes = node.unboundAttributes;

    this.resolver.accept(node.resolver);

    return this;
  }
};

export const Path = class AgastPath extends WeakStackFrame {
  static from(context, tag) {
    return Path.create(context, tag);
  }

  constructor(context, reference) {
    super();

    if (reference && reference.type !== 'Reference') {
      throw new Error('Invalid reference for path');
    }

    this.context = context;
    this.reference = reference;

    let skipIdx = 0;
    let skipAmount = skipAmounts[skipIdx];
    let skips;
    while ((this.depth & skipAmount) === skipAmount) {
      if (!skips) {
        skips = [];
        skipsByPath.set(this, skips);
      }

      skips[skipIdx] = this.at(this.depth - skipAmount);

      skipIdx++;
      skipAmount = skipAmounts[skipIdx];
    }

    new PathFacade(this);
  }

  at(depth) {
    let parent = this;

    if (depth > this.depth) throw new Error();

    let d = this.depth;
    for (; d > depth; ) {
      const skips = skipsByPath.get(this);
      parent = (skips && findRight(skips, (skip) => d - skip > depth)) || parent.parent;
      d = parent.depth;
    }
    return parent;
  }

  *parents(includeSelf = false) {
    if (includeSelf) yield this;
    let parent = this;
    while ((parent = parent.parent)) {
      yield parent;
    }
  }
};
