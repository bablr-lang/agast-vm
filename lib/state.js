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
} from '@bablr/agast-helpers/tree';
import {
  buildBeginningOfStreamToken,
  buildEmbeddedNode,
  nodeFlags,
} from '@bablr/agast-vm-helpers/internal-builders';
import * as sym from '@bablr/agast-helpers/symbols';
import { facades, actuals } from './facades.js';
import { Path } from './path.js';

const { hasOwn } = Object;

const arrayLast = (arr) => arr[arr.length - 1];

const createNodeWithState = (startTag, options = {}) => {
  const { unboundAttributes } = options;
  const node = createNode(startTag);
  nodeStates.set(node, {
    resolver: new Resolver(node),
    unboundAttributes: new Set(unboundAttributes || []),
  });
  return node;
};

const symbolTypeFor = (type) => {
  // prettier-ignore
  switch (type) {
    case 'NullTag': return sym.null;
    case 'GapTag': return sym.gap;
    default: throw new Error();
  }
};

const buildStubNode = (tag) => {
  return {
    flags: nodeFlags,
    language: null,
    type: symbolTypeFor(tag.type),
    children: [tag],
    properties: {},
    attributes: {},
  };
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
    return actuals.get(this).nodeForPath(path);
  }

  pathForTag(tag) {
    return actuals.get(this).pathForTag(tag);
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

  get resolver() {
    return nodeStates.get(this.node).resolver;
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

  advance(Tag, options = {}) {
    const ctx = this.context;
    const { prevTags, nextTags } = ctx;

    if (Tag) {
      if (prevTags.has(Tag)) {
        throw new Error('Double emit');
      }

      if (
        this.result?.type === 'ReferenceTag' &&
        !['OpenNodeTag', 'GapTag', 'NullTag'].includes(Tag.type)
      ) {
        throw new Error(`${Tag.type} is not a valid reference target`);
      }

      prevTags.set(Tag, this.result);
      nextTags.set(this.result, Tag);

      switch (Tag.type) {
        case 'DoctypeTag': {
          this.path = Path.from(ctx, Tag);

          this.tagPaths.set(Tag, this.path);
          break;
        }

        case 'OpenNodeTag': {
          const openTag = Tag;
          const { type, flags } = Tag.value;
          this.node = createNodeWithState(Tag, options);

          const reference = this.result;

          this.node.children.push(Tag);

          if (!type) {
            this.node.attributes = this.result.value.attributes;
          } else {
            if (!flags.trivia && !flags.escape) {
              if (
                reference.type !== 'ReferenceTag' &&
                reference.type !== 'ShiftTag' &&
                reference.type !== 'OpenNodeTag' &&
                !reference.value.type
              ) {
                throw new Error('Invalid location for OpenNodeTag');
              }
            } else {
              this.path = this.path.push(ctx, null);
            }
          }

          this.pathNodes.set(this.node, this.path);
          this.pathNodes.set(this.path, this.node);

          this.tagNodes.set(openTag, this.node);
          this.tagPaths.set(openTag, this.path);
          break;
        }

        case 'CloseNodeTag': {
          const openTag = this.node.children[0];
          const { flags, type: openType } = openTag.value;
          const closeTag = Tag;
          const { type } = closeTag.value;

          this.node.children.push(Tag);

          if (openType) {
            if (this.node.unboundAttributes?.size)
              throw new Error('Grammar failed to bind all attributes');

            if (!type) throw new Error(`CloseNodeTag must have type`);

            if (type !== openType)
              throw new Error(
                `Grammar close {type: ${printType(type)}} did not match open {type: ${printType(openType)}}`,
              );

            if (!flags.escape && !flags.trivia) {
              const { name: refName, isArray } = this.path.reference.value;

              const { properties } = this.parentNode;

              if (!isArray) {
                properties[refName] = this.node;
              } else {
                if (!hasOwn(properties, refName)) {
                  properties[refName] = [];
                }
                properties[refName].push(this.node);
              }
            } else {
              this.parentNode.children.push(buildEmbeddedNode(this.node));
            }
          }

          this.tagNodes.set(closeTag, this.node);
          this.tagPaths.set(closeTag, this.path);

          finalizeNode(this.node);

          this.node = this.parentNode;
          this.path = this.path.parent;
          break;
        }

        case 'ReferenceTag': {
          if (this.path.depth) {
            nodeStates.get(this.node).resolver.consume(Tag);
          }

          this.node.children.push(Tag);

          this.path = this.path.push(ctx, Tag);

          this.tagPaths.set(Tag, this.path);
          break;
        }

        case 'GapTag': {
          this.tagPaths.set(Tag, this.path);

          let target;
          let ref = arrayLast(this.node.children);

          if (ref.type !== 'ReferenceTag') throw new Error();

          if (this.held) {
            target = this.held.node;

            this.held = null;
          } else if (this.expressions.size) {
            const expression = this.expressions.value;
            target = getRoot(expression);
            this.expressions = this.expressions.pop();
          } else {
            target = buildStubNode(Tag);
          }

          this.pathNodes.set(this.pathForTag(ref), target);
          add(this.node, ref, target);

          this.path = this.path.parent;
          break;
        }

        case 'NullTag': {
          this.tagPaths.set(Tag, this.path);

          const { properties } = this.node;
          const { isArray, name } = this.result.value;

          const newNode = buildStubNode(Tag);

          if (!hasOwn(properties, name)) {
            // TODO is this behavior right
            properties[name] = isArray ? [] : newNode;
          }

          this.pathNodes.set(this.path, newNode);

          this.path = this.path.parent;
          break;
        }

        case 'ShiftTag': {
          const finishedNode = this.nodeForTag(this.result);
          const ref = ctx.getPreviousTag(getOpenTag(finishedNode));
          const finishedPath = this.pathForTag(ref);
          const { properties } = this.node;

          this.pathNodes.set(finishedPath, null);

          this.held = { node: finishedNode, path: finishedPath };

          let node = properties[ref.value.name];

          if (ref.value.isArray) {
            node = arrayLast(node);
            properties[ref.value.name].pop();
          } else {
            properties[ref.value.name] = null;
          }

          this.path = finishedPath;
          break;
        }

        case 'LiteralTag': {
          this.node.children.push(Tag);
          break;
        }

        default:
          throw new Error();
      }
    }

    this.result = Tag;

    return Tag;
  }

  *emit() {
    const { nextTags } = this.context;
    if (!this.depth) {
      let emittable = this.emitted ? nextTags.get(this.emitted) : this.result;

      while (
        emittable &&
        !(
          emittable.type === 'OpenNodeTag' &&
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
    return this.tag.type === 'NodeGapTag';
  }

  get speculative() {
    return !!this.parent;
  }

  get parentNode() {
    return this.pathNodes.get(this.path.parent);
  }

  branch() {
    const { context, expressions, path, node, result, emitted, held, internalContext } = this;
    const { pathNodes } = internalContext;

    const newNode = node && branchNode(node);

    const nodeState = nodeStates.get(node);

    pathNodes.set(path, newNode);

    nodeStates.set(newNode, { ...nodeState, resolver: nodeState.resolver.branch() });

    const nodeOpen = getOpenTag(node);
    const nodeClose = getCloseTag(node);
    if (nodeOpen) this.tagNodes.set(nodeOpen, newNode);
    if (nodeClose) this.tagNodes.set(nodeClose, newNode);

    return this.push(context, expressions, path, newNode, result, emitted, held, internalContext);
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
