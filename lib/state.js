import emptyStack from '@iter-tools/imm-stack';
import { WeakStackFrame } from '@bablr/weak-stack';
import {
  Resolver,
  add,
  createNode,
  getOpenTag,
  getCloseTag,
  branchNode,
  acceptNode,
  finalizeNode,
  getRoot,
  printType,
  buildStubNode,
} from '@bablr/agast-helpers/tree';
import * as btree from '@bablr/agast-helpers/btree';
import {
  buildBeginningOfStreamToken,
  buildEmbeddedNode,
} from '@bablr/agast-vm-helpers/internal-builders';
import {
  DoctypeTag,
  OpenNodeTag,
  CloseNodeTag,
  ReferenceTag,
  ShiftTag,
  GapTag,
  NullTag,
  ArrayTag,
  LiteralTag,
  OpenFragmentTag,
  CloseFragmentTag,
} from '@bablr/agast-helpers/symbols';
import { facades, actuals } from './facades.js';
import { Path } from './path.js';
import { isArray } from 'iter-tools-es';

const { hasOwn } = Object;

const createNodeWithState = (openTag, options = {}) => {
  const { unboundAttributes } = options;
  const node = createNode(openTag);
  nodeStates.set(node, {
    unboundAttributes: new Set(unboundAttributes || []),
  });
  return node;
};

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

  nodeForPath(path) {
    return actuals.get(this).nodeForPath(actuals.get(path));
  }

  pathForTag(tag) {
    return facades.get(actuals.get(this).pathForTag(tag));
  }

  nodeForTag(tag) {
    return actuals.get(this).nodeForTag(tag);
  }
};

export const nodeStates = new WeakMap();

export const State = class AgastState extends WeakStackFrame {
  constructor(
    context,
    expressions = emptyStack,
    path = null,
    node = null,
    result = buildBeginningOfStreamToken(),
    emitted = null,
    held = null,
    resolver = new Resolver(),
    internalContext = {
      pathNodes: new WeakMap(),
      tagPaths: new WeakMap(),
      tagNodes: new WeakMap(),
    },
  ) {
    super();

    if (!context) throw new Error('invalid args to tagState');

    this.context = context;
    this.expressions = expressions;
    this.path = path;
    this.node = node;
    this.result = result;
    this.emitted = emitted;
    this.held = held;
    this.resolver = resolver;
    this.internalContext = internalContext;

    new StateFacade(this);
  }

  static from(context, expressions = []) {
    return State.create(context, emptyStack.push(...[...expressions].reverse()));
  }

  get pathNodes() {
    return this.internalContext.pathNodes;
  }

  get tagPaths() {
    return this.internalContext.tagPaths;
  }

  get tagNodes() {
    return this.internalContext.tagNodes;
  }

  get unboundAttributes() {
    return nodeStates.get(this.node).unboundAttributes;
  }

  get holding() {
    return !!this.held;
  }

  nodeForPath(path) {
    return this.pathNodes.get(path);
  }

  pathForTag(ref) {
    return this.tagPaths.get(ref);
  }

  nodeForTag(tag) {
    return this.tagNodes.get(tag);
  }

  advance(tag, options = {}) {
    const ctx = this.context;
    const { prevTags, nextTags } = ctx;

    if (tag) {
      if (prevTags.has(tag)) {
        throw new Error('Double emit');
      }

      if (
        this.result?.type === ReferenceTag &&
        ![OpenNodeTag, GapTag, NullTag, ArrayTag].includes(tag.type)
      ) {
        throw new Error(`${printType(tag.type)} is not a valid reference target`);
      }

      prevTags.set(tag, this.result);
      nextTags.set(this.result, tag);

      this.resolver.advance(tag);

      switch (tag.type) {
        case DoctypeTag: {
          this.path = Path.from(ctx, tag);

          this.tagPaths.set(tag, this.path);
          break;
        }

        case OpenNodeTag: {
          const openTag = tag;
          const { flags } = tag.value;
          this.node = createNodeWithState(tag, options);

          const reference = this.result;

          this.node.children = btree.push(this.node.children, tag);

          if (!flags.trivia && !flags.escape) {
            if (
              reference.type !== ReferenceTag &&
              reference.type !== ShiftTag &&
              reference.type !== OpenNodeTag &&
              !reference.value.type
            ) {
              throw new Error('Invalid location for OpenNodeTag');
            }
          } else {
            this.path = this.path.push(ctx, null, btree.getSum(this.node.children));
          }

          this.pathNodes.set(this.node, this.path);
          this.pathNodes.set(this.path, this.node);

          this.tagNodes.set(openTag, this.node);
          this.tagPaths.set(openTag, this.path);
          break;
        }

        case OpenFragmentTag: {
          const openTag = tag;
          this.node = createNodeWithState(tag, options);

          const reference = this.result;

          this.node.attributes = this.result.value.attributes;
          this.node.children = btree.push(this.node.children, reference);

          this.node.children = btree.push(this.node.children, tag);

          this.pathNodes.set(this.node, this.path);
          this.pathNodes.set(this.path, this.node);

          this.tagNodes.set(openTag, this.node);
          this.tagPaths.set(openTag, this.path);
          break;
        }

        case CloseNodeTag: {
          const openTag = getOpenTag(this.node);
          const { flags, type: openType } = openTag.value;
          const closeTag = tag;
          const { type } = closeTag.value;

          this.node.children = btree.push(this.node.children, tag);

          if (this.node.unboundAttributes?.size)
            throw new Error('Grammar failed to bind all attributes');

          if (!type) throw new Error(`CloseNodeTag must have type`);

          if (type !== openType)
            throw new Error(
              `Grammar close {type: ${printType(type)}} did not match open {type: ${printType(
                openType,
              )}}`,
            );

          if (!flags.escape && !flags.trivia) {
            add(this.parentNode, this.path.reference, this.node);
          } else if (this.parentNode) {
            this.parentNode.children = btree.push(
              this.parentNode.children,
              buildEmbeddedNode(this.node),
            );
          }

          this.tagNodes.set(closeTag, this.node);
          this.tagPaths.set(closeTag, this.path);

          finalizeNode(this.node);

          this.node = this.parentNode;
          this.path = this.path.parent;
          break;
        }

        case CloseFragmentTag: {
          const closeTag = tag;

          this.node.children = btree.push(this.node.children, tag);

          this.tagNodes.set(closeTag, this.node);
          this.tagPaths.set(closeTag, this.path);

          finalizeNode(this.node);

          this.node = this.parentNode;
          this.path = this.path.parent;
          break;
        }

        case ReferenceTag: {
          this.node.children = btree.push(this.node.children, tag);

          const { isArray, name, hasGap } = tag.value;

          if (hasGap && !this.node.flags.hasGap) {
            throw new Error('gap reference in gapless node');
          }

          if (isArray && !hasOwn(this.node.properties, name)) {
            this.node.properties[name] = [];
          } else {
            this.path = this.path.push(ctx, tag, btree.getSum(this.node.children));
          }

          this.tagPaths.set(tag, this.path);
          break;
        }

        case GapTag: {
          this.tagPaths.set(tag, this.path);

          let target;
          let ref = btree.getAt(-1, this.node.children);

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
              } else {
                target = expression != null ? getRoot(expression) : buildStubNode(tag);

                this.expressions = this.expressions.pop();
              }

              // const range = ctx.buildRange(streamFromTree(target));

              // this node is only interpolated into the tree, not the stream
              // the stream still contains a gap token, even if expressions were specified
              // get rid of the gap token in the stream!
            } else {
              target = buildStubNode(tag);
            }
          }

          this.tagNodes.set(tag, target);

          this.pathNodes.set(this.pathForTag(ref), target);
          add(this.node, ref, target);

          this.path = this.path.parent;
          break;
        }

        case NullTag: {
          this.tagPaths.set(tag, this.path);

          const { properties } = this.node;
          const { isArray, name } = this.result.value;

          const newNode = buildStubNode(tag);

          if (!hasOwn(properties, name)) {
            properties[name] = newNode;
          }

          this.pathNodes.set(this.path, newNode);

          this.path = this.path.parent;
          break;
        }

        case ShiftTag: {
          const finishedNode = this.nodeForTag(this.result);
          const ref = ctx.getPreviousTag(getOpenTag(finishedNode));
          const finishedPath = this.pathForTag(ref);
          const { properties } = this.node;

          this.pathNodes.set(finishedPath, null);

          this.held = { node: finishedNode, path: finishedPath };

          let node = properties[ref.value.name];

          if (ref.value.isArray) {
            node = btree.getAt(-1, node);
            properties[ref.value.name] = btree.pop(properties[ref.value.name]);
          } else {
            properties[ref.value.name] = null;
          }

          this.path = finishedPath;
          break;
        }

        case LiteralTag:
        case ArrayTag:
          this.node.children = btree.push(this.node.children, tag);
          break;

        default:
          throw new Error();
      }
    }

    this.result = tag;

    return tag;
  }

  *emit() {
    const { nextTags } = this.context;
    if (!this.depth) {
      let emittable = this.emitted ? nextTags.get(this.emitted) : this.result;

      while (
        emittable &&
        !(
          emittable.type === OpenNodeTag &&
          emittable.value.type &&
          nodeStates.get(this.nodeForTag(emittable)).unboundAttributes?.size
        )
      ) {
        yield emittable;
        this.emitted = emittable;
        emittable = nextTags.get(this.emitted);
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
    return this.pathNodes.has(this.path) ? this.pathNodes.get(this.path.parent) : this.node;
  }

  branch() {
    const { context, expressions, path, node, result, emitted, held, resolver, internalContext } =
      this;
    const { pathNodes } = internalContext;

    const newNode = node && branchNode(node);

    const nodeState = nodeStates.get(node);

    pathNodes.set(path, newNode);
    pathNodes.set(newNode, path);

    nodeStates.set(newNode, { ...nodeState });

    const nodeOpen = getOpenTag(node);
    const nodeClose = getCloseTag(node);
    if (nodeOpen) this.tagNodes.set(nodeOpen, newNode);
    if (nodeClose) this.tagNodes.set(nodeClose, newNode);

    return this.push(
      context,
      expressions,
      path,
      newNode,
      result,
      emitted,
      held,
      resolver.branch(),
      internalContext,
    );
  }

  accept() {
    const { parent } = this;

    if (!parent) {
      return null;
    }

    if (this.node && parent.node) {
      acceptNode(parent.node, this.node);
      const nodeState = nodeStates.get(this.node);
      Object.assign(nodeStates.get(parent.node), nodeState);
    } else {
      parent.node = this.node;
    }

    // emitted isn't used here and probably doesn't need to be part of state

    parent.expressions = this.expressions;
    parent.result = this.result;
    parent.held = this.held;
    parent.path = this.path;
    parent.node = this.node;
    parent.resolver = this.resolver;

    return parent;
  }

  reject() {
    const { parent, context, pathNodes, tagNodes } = this;

    if (!parent) throw new Error('rejected root state');

    context.nextTags.delete(parent.result);

    pathNodes.set(parent.path, parent.node);

    if (getOpenTag(parent.node)) tagNodes.set(getOpenTag(parent.node), parent.node);
    if (getCloseTag(parent.node)) tagNodes.set(getCloseTag(parent.node), parent.node);

    return parent;
  }
};
