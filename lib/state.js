import {
  add,
  finalizeNode,
  getRoot,
  buildStubNode,
  getRange,
  buildNullTag,
  treeFromStream,
  createNode,
  buildNullNode,
  buildOpenNodeTag,
} from '@bablr/agast-helpers/tree';
import * as sumtree from '@bablr/agast-helpers/sumtree';
import {
  getInitializerChildrenIndex,
  getOpenTag,
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
  EmbeddedNode,
  AttributeDefinition,
} from '@bablr/agast-helpers/symbols';
import { facades, actuals } from './facades.js';
import { Path } from './path.js';
import { get, has, immSet, isObject } from '@bablr/agast-helpers/object';

const { isArray } = Array;

const defineAttribute = (node, path, value) => {
  let openTag = getOpenTag(node);
  let { attributes } = node;

  if (!has(attributes, path) && get(attributes, path) !== undefined)
    throw new Error('Can only define undefined attributes');

  if (value === undefined) throw new Error('cannot define attribute to undefined');

  let { flags, language, type } = openTag.value;
  attributes = immSet(attributes, path, value);
  let newOpenTag = buildOpenNodeTag(flags, language, type, attributes);

  node.attributes = attributes;

  node.children = sumtree.replaceAt(0, node.children, newOpenTag);
};

export const StateFacade = class AgastStateFacade {
  constructor(state) {
    facades.set(state, this);
  }

  static create() {
    return State.create();
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

  get path() {
    return actuals.get(this).path;
  }

  get node() {
    return actuals.get(this).node;
  }

  get done() {
    return actuals.get(this).done;
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

  get parent() {
    return facades.get(actuals.get(this).parent);
  }
};

export const nodeStates = new WeakMap();

export const State = class AgastState {
  static create() {
    return new State();
  }

  constructor(path = Path.from(createNode()), held = null, resultPath = null) {
    if (!path) throw new Error('invalid args to tagState');

    this.path = path;
    this.held = held;
    this.resultPath = resultPath;
    this.done = false;
    this.referencePath = null;

    if (!this.node) throw new Error();

    new StateFacade(this);
  }

  static from() {
    return State.create();
  }

  get holding() {
    return !!this.held;
  }

  get atReference() {
    return !![ReferenceTag, ShiftTag].includes(this.resultPath?.tag.type);
  }

  advance(tag) {
    if (!tag) throw new Error();

    if (this.done) throw new Error();

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
        let { type, isArray, name, flags } = tag.value;

        if (this.atReference) throw new Error('invalid location for reference');
        if (!name && !type) throw new Error();
        if (type && !['.', '#', '@'].includes(type)) throw new Error();
        if (['#', '@'].includes(type) && isArray) throw new Error();

        if (this.held && sumtree.getAt(2, this.node.children)?.type === InitializerTag) {
          if (
            !referencesAreEqual(sumtree.getAt(1, this.node.children), tag) ||
            sumtree.getSize(this.node.children) > 3
          ) {
            throw new Error();
          }
        }

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

        if (this.node.undefinedAttributes > 0) {
          throw new Error('Grammar failed to bind all attributes');
        }

        if (this.node.type) {
          for (const value of Object.values(this.node.properties)) {
            if (!Array.isArray(value)) {
              if (value.node === undefined) {
                add(this.node, value.reference, buildNullNode());
              }
            }
          }
        }

        let path = [];
        let queue = [this.node.attributes];
        while (queue.length) {
          for (const { 0: key, 1: value } of Object.entries(queue[queue.length - 1])) {
            if (value === undefined) {
              path.push(key);
              defineAttribute(this.node, path, null);
              path.pop(key);
            } else if (isArray(value) || isObject(value)) {
              queue.push(value);
              path.push(key);
            }
          }
          queue.pop();
        }

        if (!this.path) {
          this.done = true;
        }

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

        if (this.held) throw new Error();

        if (!this.atReference && this.parent) {
          throw new Error('Invalid location for OpenNodeTag');
        }

        let stubNode = buildStubNode(tag);

        add(parentNode, reference, stubNode);

        targetPath = this.path.push(stubNode, sumtree.getSize(this.node.children) - 2);
        break;
      }

      case EmbeddedNode: {
        const { node: parentNode, referencePath: lastRefPath } = this;

        if (!this.atReference) {
          throw new Error('invalid location for EmbeddedNode');
        }

        let refTag = lastRefPath.tag;

        if (refTag.type === ShiftTag) {
          let refIndex = lastRefPath.childrenIndex - lastRefPath.tag.value.index * 2;
          refTag = sumtree.getAt(refIndex, this.node.children);
        }

        add(
          parentNode,
          refTag,
          tag.value,
          lastRefPath.tag.type === ShiftTag
            ? lastRefPath.tag.value.index
            : refTag.value.flags.expression
            ? 0
            : null,
        );

        break;
      }

      case AttributeDefinition: {
        let { path, value } = tag.value;

        if (this.held) throw new Error('invalid place for an atrribute binding');

        defineAttribute(this.node, path, value);

        break;
      }

      case InitializerTag: {
        const { isArray } = tag.value;
        const { node, reference } = this;
        const { name } = reference.value;

        if (!this.atReference && this.parent) {
          throw new Error('Invalid location for OpenNodeTag');
        }

        if (this.held && sumtree.getAt(2, node.children)?.type === InitializerTag) {
          throw new Error();
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

        if (tag.value.index <= 0) throw new Error();

        if (ref.type !== ReferenceTag) throw new Error();

        this.held = { node: finishedNode, path: finishedPath };

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
    return this.referencePath?.tag;
  }

  get node() {
    return this.path?.node;
  }
};
