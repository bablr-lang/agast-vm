import emptyStack from '@iter-tools/imm-stack';
import { WeakStackFrame } from '@bablr/weak-stack';
import {
  Resolver,
  add,
  createNode,
  getOpenTag,
  branchNode,
  acceptNode,
  finalizeNode,
  getRoot,
  buildStubNode,
  streamFromTree,
  getRange,
  buildNullTag,
  treeFromStream,
} from '@bablr/agast-helpers/tree';
import * as btree from '@bablr/agast-helpers/btree';
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
import { isArray } from 'iter-tools-es';
import { TagPath } from '@bablr/agast-helpers/path';

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

  get context() {
    return facades.get(actuals.get(this).context);
  }

  get path() {
    return facades.get(actuals.get(this).path);
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

export const State = class AgastState extends WeakStackFrame {
  constructor(
    parent,
    context,
    expressions = emptyStack,
    path = null,
    emitted = null,
    held = null,
    result = null,
    resolver = new Resolver(),
  ) {
    super(parent);

    if (!context) throw new Error('invalid args to tagState');

    this.context = context;
    this.expressions = expressions;
    this.path = path;
    this.emitted = emitted;
    this.held = held;
    this.result = result;
    this.resolver = resolver;

    new StateFacade(this);
  }

  static from(context, expressions = []) {
    return State.create(context, emptyStack.push(...[...expressions].reverse()));
  }

  get unboundAttributes() {
    return nodeStates.get(this.node).unboundAttributes;
  }

  get holding() {
    return !!this.held;
  }

  createNodeWithState(openTag, options = {}) {
    const { unboundAttributes } = options;
    const node = createNode(openTag);
    nodeStates.set(node, {
      unboundAttributes: new Set(unboundAttributes || []),
    });
    return node;
  }

  updatePath(tag) {
    const i = btree.getSum(this.node.children) - 1;

    const { childrenIndexes, referenceIndexes } = this.path;

    if (tag.type === ReferenceTag) {
      const { name, isArray, index: literalArrayIndex } = tag.value;

      const arrayIndex = isArray ? this.resolver.properties.get(name)?.count - 1 : null;

      if (literalArrayIndex != null && literalArrayIndex !== arrayIndex) throw new Error();

      referenceIndexes[i] = arrayIndex;

      if (isArray) {
        if (!hasOwn(childrenIndexes, name) || childrenIndexes[name] === null) {
          childrenIndexes[name] = [];
        } else {
          childrenIndexes[name][arrayIndex] = i;
        }
      } else {
        childrenIndexes[name] = i;
      }
    } else if (tag.type === ArrayInitializerTag) {
      childrenIndexes;
    } else {
      referenceIndexes[i] = null;
    }
  }

  advance(tag, options = {}) {
    const ctx = this.context;

    if (!tag) throw new Error();

    let targetPath = this.path;

    switch (tag.type) {
      case DoctypeTag: {
        let node = this.createNodeWithState(tag, options);
        let path = Path.from(node);

        node.children = btree.push(node.children, tag);
        node.attributes = tag.value.attributes;

        this.resolver.advance(tag);
        this.path = path;
        this.updatePath(tag);

        targetPath = path;
        break;
      }

      case OpenFragmentTag: {
        const openTag = tag;

        this.resolver.advance(tag);
        this.updatePath(tag);

        this.node.flags = openTag.value.flags;
        this.node.children = btree.push(this.node.children, tag);
        this.node.type = null;
        this.node.language = this.node.attributes['bablr-language'];

        break;
      }

      case CloseFragmentTag: {
        this.resolver.advance(tag);
        this.updatePath(tag);
        this.node.children = btree.push(this.node.children, tag);

        finalizeNode(this.node);

        // this.node = this.parentNode;
        // this.path = this.path.parent;
        break;
      }

      case ReferenceTag: {
        this.resolver.advance(tag);
        this.node.children = btree.push(this.node.children, tag);
        this.updatePath(tag);

        const { hasGap } = tag.value;

        if (hasGap && !this.node.flags.hasGap) {
          throw new Error('gap reference in gapless node');
        }

        break;
      }

      case OpenNodeTag: {
        let node = this.createNodeWithState(tag, options);
        this.path = this.path.push(node, btree.getSum(this.node.children) - 1);

        targetPath = this.path;

        this.node.children = btree.push(this.node.children, tag);

        add(this.parentNode, this.path.reference, this.node);

        this.resolver.advance(tag);
        this.updatePath(tag);

        break;
      }

      case CloseNodeTag: {
        const openTag = getOpenTag(this.node);
        const { flags } = openTag.value;

        this.resolver.advance(tag);
        this.node.children = btree.push(this.node.children, tag);
        this.updatePath(tag);

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
        this.updatePath(tag);

        if (ref.type !== ReferenceTag) throw new Error();

        if (this.held) {
          target = this.held.node;

          this.held = null;
        } else {
          if (!this.node.flags.hasGap) throw new Error('Node must allow gaps');

          if (this.expressions.size) {
            const expression = this.expressions.value;

            if (isArray(expression)) {
              throw new Error('Invalid array interpolation');
            }

            if (expression == null) {
              target = treeFromStream(buildNullTag());
            } else {
              target = getRoot(expression);
            }

            this.expressions = this.expressions.pop();
          } else {
            target = buildStubNode(tag);
          }
        }

        const range = getRange(target);

        throw new Error('not implemented');
        // this.result = range[1];

        add(this.node, ref, target);
        break;
      }

      case NullTag: {
        const { node, path, result } = this;
        const { properties } = node;
        const { reference } = path;
        const { name } = result.child.value;

        this.resolver.advance(tag);
        this.updatePath(tag);

        if (!name) throw new Error();

        let stubNode = buildStubNode(tag);

        targetPath = this.path.push(stubNode, btree.getSum(this.node.children) - 1);

        if (!hasOwn(properties, name)) {
          properties[name] = { reference, node: stubNode };
        }
        break;
      }

      case ArrayInitializerTag: {
        const { name } = this.reference.value;

        this.resolver.advance(tag);
        this.updatePath(tag);

        this.node.children = btree.push(this.node.children, tag);
        this.node.properties[name] = [];
        break;
      }

      case ShiftTag: {
        this.resolver.advance(tag);
        this.updatePath(tag);

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
        this.updatePath(tag);
        this.node.children = btree.push(this.node.children, tag);
        break;

      default:
        throw new Error();
    }

    this.result = new TagPath(targetPath, btree.getSum(targetPath.node.children) - 1);

    if (this.result.child !== tag) throw new Error();

    return tag;
  }

  *emit() {
    if (!this.depth) {
      let emittable = this.emitted ? this.emitted.next : this.result;

      while (
        emittable &&
        !(
          emittable.child.type === OpenNodeTag &&
          emittable.child.value.type &&
          nodeStates.get(emittable.path.node).unboundAttributes?.size
        )
      ) {
        yield emittable.child;

        this.emitted = emittable;
        emittable = this.emitted.next;
      }
    }
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

  get node() {
    return this.path?.node;
  }

  branch() {
    const { context, expressions, path, emitted, held, result, resolver, innerContext } = this;
    const { node, referenceIndex } = path;
    const newNode = node && branchNode(node);
    const newPath = path.replace(newNode, referenceIndex);
    const nodeState = nodeStates.get(node);

    nodeStates.set(newNode, { ...nodeState });

    return this.push(
      context,
      expressions,
      newPath,
      [btree.getSum(emitted), [emitted, []]],
      held,
      result,
      resolver.branch(),
      innerContext,
    );
  }

  accept() {
    const { parent } = this;

    if (!parent) {
      return null;
    }

    if (this.node && parent.node) {
      const nodeState = nodeStates.get(this.node);
      Object.assign(nodeStates.get(parent.node), nodeState);
    }

    parent.expressions = this.expressions;
    parent.emitted = this.emitted;
    parent.held = this.held;
    parent.path = this.path;
    parent.result = this.result;
    parent.resolver = this.resolver;

    return parent;
  }

  reject() {
    const { parent } = this;

    if (!parent) throw new Error('rejected root state');

    this.path = null;
    this.result = null;

    return parent;
  }
};
