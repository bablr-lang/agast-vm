import isArray from 'iter-tools-es/methods/is-array';
import { WeakStackFrame } from '@bablr/weak-stack';
import {
  add,
  finalizeNode,
  getRoot,
  buildStubNode,
  getRange,
  buildNullTag,
  treeFromStream,
  createNode,
  buildReferenceTag,
} from '@bablr/agast-helpers/tree';
import * as sumtree from '@bablr/agast-helpers/sumtree';
import {
  getInitializerChildrenIndex,
  getPropertyChildrenIndex,
  referencesAreEqual,
  TagPath,
} from '@bablr/agast-helpers/path';
import {
  DoctypeTag,
  OpenNodeTag,
  CloseNodeTag,
  ReferenceTag,
  ShiftTag,
  GapTag,
  NullTag,
  InitializerTag,
  LiteralTag,
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

  get resultPath() {
    return actuals.get(this).resultPath;
  }

  get reference() {
    return actuals.get(this).reference;
  }

  get referencePath() {
    return actuals.get(this).referencePath;
  }

  get unshiftedReferencePath() {
    return actuals.get(this).unshiftedReferencePath;
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

export const State = class AgastState extends WeakStackFrame {
  constructor(
    parent,
    context,
    expressions = [],
    path = Path.from(createNode()),
    held = null,
    resultPath = null,
  ) {
    super(parent);

    if (!context || !path || !expressions) throw new Error('invalid args to tagState');

    this.context = context;
    this.expressions = new Coroutine(expressions[Symbol.iterator]());
    this.path = path;
    this.held = held;
    this.resultPath = resultPath;
    this.referencePath = null;

    if (!this.node) throw new Error();

    new StateFacade(this);
  }

  static from(context, expressions = []) {
    return State.create(context, expressions);
  }

  get holding() {
    return !!this.held;
  }

  get atReference() {
    return !![ReferenceTag, ShiftTag].includes(this.resultPath?.tag.type);
  }

  advance(tag) {
    if (!tag) throw new Error();

    let targetPath = this.path;

    switch (tag.type) {
      case DoctypeTag: {
        let { path, node } = this;

        if (this.resultPath) throw new Error('invalid location for doctype');

        node.children = sumtree.push(node.children, tag);
        node.attributes = tag.value.attributes;

        targetPath = path;
        break;
      }

      case ReferenceTag: {
        let { name, isArray, flags } = tag.value;

        if (this.atReference) throw new Error('invalid location for reference');
        if (!name) throw new Error('missing reference name');
        if (!/#|@|[.]|[a-zA-Z]+/.test(name)) throw new Error('invalid reference name');

        if (this.node.properties[name] && this.node.properties[name]?.node === undefined) {
          let existingReferenceIndex = getInitializerChildrenIndex(this.node, tag);
          let existingReference = sumtree.getAt(existingReferenceIndex, this.node.children);
          if (!referencesAreEqual(tag, existingReference)) {
            throw new Error("reference didn't match initializer");
          }
        }

        this.node.children = sumtree.push(this.node.children, tag);

        if (flags.hasGap && !this.node.flags.hasGap) {
          throw new Error('gap reference in gapless node');
        }

        this.referencePath = TagPath.from(this.path, -1);

        break;
      }

      case OpenNodeTag: {
        let parentNode = this.node;

        targetPath = this.path;

        if (!this.atReference && this.parent) {
          throw new Error('Invalid location for OpenNodeTag');
        }

        if (!this.path.depth) {
          this.node.flags = tag.value.flags;
          this.node.children = sumtree.push(this.node.children, tag);
          this.node.type = tag.value.type;
          this.node.language = tag.value.language;
          this.node.attributes = tag.value.attributes || {};
        } else {
          let node = createNode(tag);
          this.path = this.path.push(node, sumtree.getSize(parentNode.children) - 2);
          add(parentNode, this.reference, node);
        }

        break;
      }

      case CloseNodeTag: {
        if (this.atReference) throw new Error('invalid location for close tag');

        this.node.children = sumtree.push(this.node.children, tag);

        if (this.node.undefinedAttributes?.size)
          throw new Error('Grammar failed to bind all attributes');

        finalizeNode(this.node);

        this.path = this.path.parent;
        break;
      }

      case GapTag: {
        let target;
        let lastTagPath = TagPath.from(this.path, -1);

        if (!this.atReference) {
          throw new Error('Invalid location for GapTag');
        }

        if (this.held && lastTagPath.tag.type !== ShiftTag) {
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

          this.held = null;
        }

        const range = getRange(target);

        this.resultPath = range ? range[1] : this.resultPath;
        this.referencePath = null;

        let lastRefPath = [ShiftTag, ReferenceTag].includes(lastTagPath.tag.type)
          ? lastTagPath
          : lastTagPath.previousSibling;

        if (![ShiftTag, ReferenceTag].includes(lastRefPath.tag.type)) throw new Error();

        let refTag = lastRefPath.tag;

        if (refTag.type === ShiftTag) {
          let refIndex = lastRefPath.childrenIndex - lastRefPath.tag.value.index * 2;
          refTag = sumtree.getAt(refIndex, this.node.children);
        }

        if (refTag) {
          add(
            this.path.node,
            refTag,
            target,
            lastRefPath.tag.type === ShiftTag
              ? lastRefPath.tag.value.index
              : refTag.value.flags.expression
              ? 0
              : null,
          );
        }

        break;
      }

      case NullTag: {
        const { node: parentNode, reference } = this;

        if (!this.atReference && this.parent) {
          throw new Error('Invalid location for OpenNodeTag');
        }

        let stubNode = buildStubNode(tag);

        add(parentNode, reference, stubNode);

        targetPath = this.path.push(stubNode, sumtree.getSize(this.node.children) - 2);
        break;
      }

      case InitializerTag: {
        const { isArray } = tag.value;
        const { node, reference } = this;
        const { name } = reference.value;

        if (!this.atReference && this.parent) {
          throw new Error('Invalid location for OpenNodeTag');
        }

        if (node.properties[name] && node.properties[name]?.node === undefined) {
          throw new Error();
        }

        add(node, reference, isArray ? [] : undefined);
        break;
      }

      case ShiftTag: {
        if (this.atReference) throw new Error('invalid location for shift');

        const finishedPath = this.resultPath.innerPath;
        const finishedNode = finishedPath.node;
        const ref = TagPath.from(
          this.resultPath,
          this.resultPath.childrenIndex - tag.value.index * 2 + 1,
        ).tag;

        this.held = { node: finishedNode, path: finishedPath };

        if (!ref.value.name) throw new Error();

        if (!ref.value.flags.expression) throw new Error();

        this.node.children = sumtree.push(this.node.children, tag);

        this.referencePath = TagPath.from(this.path, -1);

        // this.path = finishedPath;
        targetPath = this.path;
        break;
      }

      case LiteralTag:
        if (typeof tag.value !== 'string') throw new Error();

        this.node.children = sumtree.push(this.node.children, tag);
        break;

      default:
        throw new Error();
    }

    this.resultPath = TagPath.from(targetPath, -1);

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
    return this.referencePath.tag;
  }

  get node() {
    return this.path?.node;
  }
};
