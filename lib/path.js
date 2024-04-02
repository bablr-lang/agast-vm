import map from 'iter-tools-es/methods/map';
import filter from 'iter-tools-es/methods/filter';
import { WeakStackFrame } from '@bablr/weak-stack';
import { Resolver } from '@bablr/agast-helpers/tree';
import { buildReference } from '@bablr/agast-helpers/builders';
import { findRight } from './utils/array.js';
import { facades, actuals } from './facades.js';
import * as sym from './symbols.js';

const skipLevels = 3;
const skipShiftExponentGrowth = 4;
const skipAmounts = new Array(skipLevels)
  .fill(null)
  .map((_, i) => 2 >> (i * skipShiftExponentGrowth));
const skipsByPath = new WeakMap();

export const PathFacade = class AgastPathFacade {
  constructor(path) {
    facades.set(path, this);
  }

  get language() {
    return actuals.get(this).language;
  }

  get type() {
    return actuals.get(this).type;
  }

  get reference() {
    return actuals.get(this).reference;
  }

  get name() {
    return actuals.get(this).name;
  }

  get parent() {
    return facades.get(actuals.get(this).parent);
  }

  get range() {
    return actuals.get(this).range;
  }

  get startTag() {
    return actuals.get(this).startTag;
  }

  get endTag() {
    return actuals.get(this).endTag;
  }

  get depth() {
    return actuals.get(this).depth;
  }

  get isToken() {
    return actuals.get(this).isToken;
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

export const Path = class AgastPath extends WeakStackFrame {
  static from(context, tag) {
    return Path.create(context, tag);
  }

  static pushTag(context, path, tag) {
    switch (tag.type) {
      case 'DoctypeTag': {
        const rootPath = Path.from(context, null);

        rootPath.range[0] = tag;

        return rootPath;
      }

      case 'Reference': {
        return path.push(context, tag);
      }

      case 'OpenFragmentTag': {
        if (!path.depth) {
          const result = path.push(context, buildReference('root', false));
          context.tagPaths.set(tag, result);
          return result;
        }
        return path;
      }

      case 'CloseFragmentTag': {
        if (path?.depth === 1) {
          return path.parent;
        }
        return path;
      }

      case 'OpenNodeTag': {
        let rootPath = path;
        if (tag.value.flags.trivia) {
          rootPath = path ? path.push(context) : Path.from(context);
        }

        if (rootPath.range[0]) throw new Error();

        rootPath.range[0] = tag;

        rootPath.unboundAttributes = new Set(
          map(
            (entry) => entry[0],
            filter((entry) => entry[1] !== sym.unbound, Object.entries(tag.value.attributes)),
          ),
        );

        return rootPath;
      }

      case 'CloseNodeTag': {
        if (!path.range[0]) throw new Error();
        if (path.range[1]) throw new Error();

        path.range[1] = tag;

        return path.parent;
      }

      default:
        throw new Error();
    }
  }

  constructor(
    context,
    reference,
    range = [null, null],
    resolver = new Resolver(),
    unboundAttributes = null,
  ) {
    super();

    this.context = context;
    this.reference = reference;
    this.range = range;
    this.resolver = resolver;
    this.unboundAttributes = unboundAttributes;

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

  get stack() {
    return this.context.paths;
  }

  get startTag() {
    return this.range[0];
  }

  get endTag() {
    return this.range[1];
  }

  get language() {
    return this.startTag?.value?.language || null;
  }

  get type() {
    return this.startTag?.value?.type || null;
  }

  get isToken() {
    return this.startTag?.value.flags?.token || false;
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

  branch() {
    const { context, reference, range, resolver, unboundAttributes } = this;

    return this.replace(
      context,
      reference,
      [...range],
      resolver.branch(),
      new Set(unboundAttributes),
    );
  }

  accept(path) {
    this.range[0] = path.range[0];
    this.range[1] = path.range[1];

    this.resolver.accept(path.resolver);

    this.unboundAttributes = path.unboundAttributes;

    return this;
  }
};
