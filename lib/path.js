import { WeakStackFrame } from '@bablr/weak-stack';
import { Resolver } from '@bablr/agast-helpers/tree';
import { skipToDepth, buildSkips } from './utils/skip.js';
import { facades, actuals } from './facades.js';

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

  at(depth) {
    return facades.get(actuals.get(this).at(depth));
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

    buildSkips(this);
  }

  get language() {
    return this.openTag.value?.language;
  }

  get type() {
    return this.openTag.value?.type || null;
  }

  get flags() {
    return this.openTag.value?.flags || {};
  }

  get attributes() {
    return this.openTag.value?.attributes || {};
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

  branch() {
    const { path, openTag, closeTag, properties, resolver, unboundAttributes } = this;

    return this.replace(
      path,
      openTag,
      closeTag,
      new Map(properties), // there is probably a better way
      resolver.branch(),
      new Set(unboundAttributes),
    );
  }

  accept(node) {
    this.path = node.path;
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

    buildSkips(this);

    new PathFacade(this);
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
