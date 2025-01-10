import { isArray } from 'iter-tools-es';
import { WeakStackFrame } from '@bablr/weak-stack';
import {
  Resolver,
  add,
  getOpenTag,
  finalizeNode,
  getRoot,
  buildStubNode,
  getRange,
  buildNullTag,
  treeFromStream,
  createNode,
  buildGapTag,
} from '@bablr/agast-helpers/tree';
import * as btree from '@bablr/agast-helpers/btree';
import { TagPath } from '@bablr/agast-helpers/path';
import {
  DoctypeTag,
  OpenNodeTag,
  CloseNodeTag,
  ReferenceTag,
  ShiftTag,
  GapTag,
  NullTag,
  ArrayInitializerTag,
  LiteralTag,
  OpenFragmentTag,
  CloseFragmentTag,
} from '@bablr/agast-helpers/symbols';
import { facades, actuals } from './facades.js';
import { Path } from './path.js';
import { Coroutine } from '@bablr/coroutine';

const { hasOwn } = Object;

export const StateFacade = class AgastStateFacade {
  constructor(state) {
    facades.set(state, this);
  }

  static from(context) {
    return State.from(actuals.get(context));
  }

  get result() {
    return actuals.get(this).result;
  }

  get reference() {
    return actuals.get(this).reference;
  }

  get referencePath() {
    return actuals.get(this).referencePath;
  }

  get context() {
    return facades.get(actuals.get(this).context);
  }

  get path() {
    return actuals.get(this).path;
  }

  get node() {
    return actuals.get(this).node;
  }

  get parentNode() {
    return actuals.get(this).parentNode;
  }

  get holding() {
    return actuals.get(this).holding;
  }

  get depth() {
    return actuals.get(this).depth;
  }

  get ctx() {
    return this.context;
  }

  get parent() {
    return facades.get(actuals.get(this).parent);
  }
};

export const nodeStates = new WeakMap();

export const updatePath = (path, tag) => {
  const { node, childrenIndexes, referenceIndexes } = path;
  const i = btree.getSum(node.children) - 1;

  if (tag.type === ReferenceTag) {
    const { name, isArray, index: literalArrayIndex } = tag.value;

    const arrayIndex = isArray
      ? hasOwn(node.properties, name)
        ? btree.getSum(node.properties[name])
        : -1
      : null;

    if (literalArrayIndex != null && literalArrayIndex !== arrayIndex) throw new Error();

    referenceIndexes[i] = arrayIndex;

    if (isArray) {
      if (!hasOwn(childrenIndexes, name) || childrenIndexes[name] === null) {
        childrenIndexes[tag.value.name] = [];
      } else {
        childrenIndexes[name][arrayIndex] = i;
      }
    } else {
      if (name !== '#' && name !== '@') {
        childrenIndexes[name] = i;
      }
    }
  } else if (tag.type === ArrayInitializerTag) {
    referenceIndexes[i] = -1;
  } else {
    referenceIndexes[i] = null;
  }
};

export const State = class AgastState extends WeakStackFrame {
  constructor(
    parent,
    context,
    expressions = [],
    path = Path.from(createNode()),
    held = null,
    result = null,
    resolver = new Resolver(),
  ) {
    super(parent);

    if (!context || !path || !expressions) throw new Error('invalid args to tagState');

    this.context = context;
    this.expressions = new Coroutine(expressions[Symbol.iterator]());
    this.path = path;
    this.held = held;
    this.result = result;
    this.resolver = resolver;

    if (!this.node) throw new Error();

    new StateFacade(this);
  }

  static from(context, expressions = []) {
    return State.create(context, expressions);
  }

  get holding() {
    return !!this.held;
  }

  advance(tag) {
    const ctx = this.context;

    if (!tag) throw new Error();

    let targetPath = this.path;

    switch (tag.type) {
      case DoctypeTag: {
        const { path, node } = this;

        node.children = btree.push(node.children, tag);
        node.attributes = tag.value.attributes;

        this.resolver.advance(tag);
        updatePath(this.path, tag);

        targetPath = path;
        break;
      }

      case OpenFragmentTag: {
        const openTag = tag;

        this.resolver.advance(tag);

        this.node.flags = openTag.value.flags;
        this.node.children = btree.push(this.node.children, tag);
        this.node.type = null;
        this.node.language = this.node.attributes['bablr-language'];

        updatePath(this.path, tag);

        break;
      }

      case CloseFragmentTag: {
        this.resolver.advance(tag);
        this.node.children = btree.push(this.node.children, tag);
        updatePath(this.path, tag);

        finalizeNode(this.node);

        this.path = this.path.parent;
        break;
      }

      case ReferenceTag: {
        this.resolver.advance(tag);

        this.node.children = btree.push(this.node.children, tag);
        updatePath(this.path, tag);

        const { hasGap } = tag.value;

        if (hasGap && !this.node.flags.hasGap) {
          throw new Error('gap reference in gapless node');
        }

        break;
      }

      case OpenNodeTag: {
        const parentNode = this.node;

        targetPath = this.path;

        if (!this.path.depth) {
          this.node.flags = tag.value.flags;
          this.node.children = btree.push(this.node.children, tag);
          this.node.type = tag.value.type;
          this.node.language = tag.value.language;
          this.node.attributes = tag.value.attributes || {};
        } else {
          let node = createNode(tag);
          this.path = this.path.push(node, btree.getSum(parentNode.children) - 2);
          add(parentNode, this.reference, node);
        }

        this.resolver.advance(tag);
        updatePath(this.path, tag);

        break;
      }

      case CloseNodeTag: {
        this.resolver.advance(tag);
        this.node.children = btree.push(this.node.children, tag);
        updatePath(this.path, tag);

        if (this.node.unboundAttributes?.size)
          throw new Error('Grammar failed to bind all attributes');

        finalizeNode(this.node);

        this.path = this.path.parent;
        break;
      }

      case GapTag: {
        let target;
        let ref = btree.getAt(-1, this.node.children);

        this.resolver.advance(tag);

        if (ref.type !== ReferenceTag) throw new Error();

        if (this.held) {
          target = this.held.node;

          this.held = null;
        } else {
          this.expressions.advance();

          if (!this.expressions.done) {
            const expression = this.expressions.value;

            if (isArray(expression)) {
              throw new Error('Invalid array interpolation');
            }

            if (expression == null) {
              target = treeFromStream(buildNullTag());
            } else {
              target = getRoot(expression);
            }
          } else {
            if (!this.node.flags.hasGap) throw new Error('Node must allow gaps');

            target = buildStubNode(tag);
          }
        }

        const range = getRange(target);

        this.result = range ? range[1] : this.result;

        add(this.path.node, ref, target);

        updatePath(this.path, tag);

        break;
      }

      case NullTag: {
        const { node: parentNode, reference } = this;
        const { name } = reference.value;

        this.resolver.advance(tag);
        updatePath(this.path, tag);

        if (!name) throw new Error();

        let stubNode = buildStubNode(tag);

        add(parentNode, reference, stubNode);

        targetPath = this.path.push(stubNode, btree.getSum(this.node.children) - 2);
        break;
      }

      case ArrayInitializerTag: {
        const { node, reference } = this;
        this.resolver.advance(tag);

        add(node, reference, []);
        updatePath(this.path, tag);
        break;
      }

      case ShiftTag: {
        this.resolver.advance(tag);
        updatePath(this.path, tag);

        const finishedNode = nodeForTag(this.result);
        const ref = getPreviousTagPath(getOpenTag(finishedNode));
        const finishedPath = ctx.pathForTag(ref);
        const { properties } = this.node;

        this.held = { node: finishedNode, path: finishedPath };

        if (!ref.value.name) throw new Error();

        let node = properties[ref.value.name];

        if (ref.value.isArray) {
          node = btree.getAt(-1, node);
          properties[ref.value.name] = btree.pop(properties[ref.value.name]);
        } else {
          properties[ref.value.name] = null;
        }

        this.path = finishedPath;
        targetPath = this.path;
        break;
      }

      case LiteralTag:
        this.resolver.advance(tag);
        updatePath(this.path, tag);
        this.node.children = btree.push(this.node.children, tag);
        break;

      default:
        throw new Error();
    }

    this.result = TagPath.from(targetPath, -1);

    return tag;
  }

  get ctx() {
    return this.context;
  }

  get isGap() {
    return this.tag.type === GapTag;
  }

  get speculative() {
    return !!this.parent;
  }

  get parentNode() {
    return this.path.parent.node;
  }

  get reference() {
    return this.resolver.reference;
  }

  get referencePath() {
    return this.reference && this.path.referencePath;
  }

  get node() {
    return this.path?.node;
  }
};
