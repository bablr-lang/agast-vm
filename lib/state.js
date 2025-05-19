import {
  addProperty,
  finalizeNode,
  buildStubNode,
  getRange,
  createNode,
  buildNullNode,
  buildOpenNodeTag,
  shiftProperty,
  buildProperty,
  add,
} from '@bablr/agast-helpers/tree';
import * as sumtree from '@bablr/agast-helpers/sumtree';
import * as btree from '@bablr/agast-helpers/btree';
import {
  getInitializerChildrenIndex,
  getOpenTag,
  getOriginalFirstNode,
  isGapNode,
  isStubNode,
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
  AttributeDefinition,
  BindingTag,
  Property,
} from '@bablr/agast-helpers/symbols';
import { facades, actuals } from './facades.js';
import { Path, PathFacade, TagPathFacade } from './path.js';
import { get, has, immSet, isObject } from '@bablr/agast-helpers/object';
import { NodeFacade } from './node.js';

const { isArray } = Array;
const { hasOwn } = Object;

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
    let { resultPath } = actuals.get(this);
    return resultPath && new TagPathFacade(resultPath);
  }

  get referenceTag() {
    return actuals.get(this).referenceTag;
  }

  get referenceTagPath() {
    let { referenceTagPath } = actuals.get(this);
    return referenceTagPath && new TagPathFacade(referenceTagPath);
  }

  get path() {
    let { path } = actuals.get(this);
    return path && new PathFacade(path);
  }

  get node() {
    let { node } = actuals.get(this);
    return node && new NodeFacade(node);
  }

  get done() {
    return actuals.get(this).done;
  }

  get parentNode() {
    let { parentNode } = actuals.get(this);
    return parentNode && new NodeFacade(parentNode);
  }

  get held() {
    let { held } = actuals.get(this);
    return held && new NodeFacade(held.node);
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

  constructor(held = null, path = null, resultPath = null) {
    this.held = held;
    this.path = path;
    this.resultPath = resultPath;
    this.done = false;
    this.referenceTagPath = null;
    this.doctype = null;

    new StateFacade(this);
  }

  static from(held) {
    return new State(held);
  }

  get holding() {
    return !!this.held;
  }

  get atReference() {
    return [ReferenceTag, ShiftTag].includes(this.resultPath?.tag.type);
  }

  get atBinding() {
    return this.resultPath?.tag.type === BindingTag;
  }

  advance(tag) {
    if (!tag) throw new Error();

    if (this.done) throw new Error();

    let targetPath = this.path;

    switch (tag.type) {
      case DoctypeTag: {
        let { path } = this;

        if (this.resultPath || this.docType) throw new Error('invalid location for doctype');

        this.doctype = tag;

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

        this.referenceTagPath = TagPath.from(this.path, -1);

        break;
      }

      case BindingTag: {
        if (!this.atReference && this.parent) {
          throw new Error('Invalid location for BindingTag');
        }

        this.node.children = sumtree.push(this.node.children, tag);
        break;
      }

      case OpenNodeTag: {
        let parentNode = this.node;

        targetPath = this.path;

        if (!this.atBinding && this.parent) {
          throw new Error('Invalid location for OpenNodeTag');
        }

        let bindingTag = parentNode && sumtree.getAt(-1, parentNode.children);

        if (bindingTag && !bindingTag.value.languagePath) throw new Error();

        let node = createNode(tag);

        if (!this.path) {
          this.path = Path.create(node);

          if (!tag.value.type) {
            node.children = sumtree.push(node.children, this.doctype);
          }
        } else {
          this.path = this.path.push(node, sumtree.getSize(parentNode.children) - 2);
          add(parentNode, this.referenceTag, node, bindingTag);
        }

        node.children = sumtree.push(node.children, tag);

        let undefinedAttributes = 0;

        let queue = [this.node.attributes];
        while (queue.length) {
          for (let value of Object.values(queue[queue.length - 1])) {
            if (value === undefined) {
              undefinedAttributes++;
            } else if (isArray(value) || isObject(value)) {
              queue.push(value);
            }
          }
          queue.pop();
        }

        if (undefinedAttributes > 0 && !this.node.flags.hasGap) throw new Error();

        nodeStates.set(this.node, { undefinedAttributes });

        break;
      }

      case CloseNodeTag: {
        if (this.atReference) throw new Error('invalid location for close tag');

        if (this.node.type) {
          for (const value of Object.values(this.node.properties)) {
            if (!Array.isArray(value) && value.node === undefined) {
              addProperty(this.node, buildProperty(value.reference, null, buildNullNode()));
            }
          }
        }

        this.node.children = sumtree.push(this.node.children, tag);

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

      case Property: {
        let target;
        let property = tag.value;
        let { node } = this.path;
        let lastTagPath = TagPath.from(this.path, -1);

        if (!this.atBinding && !isStubNode(property.node)) {
          throw new Error('Invalid location for Property');
        }

        if (this.held) {
          if (isGapNode(property.node)) {
            property = this.held;
          } else {
            let matchesHeld =
              isGapNode(property.node) ||
              this.held.node === property.node ||
              getOriginalFirstNode(property.node) === this.held.node;
            if (!matchesHeld) {
              throw new Error();
            }
          }
        }

        if (this.held && lastTagPath.previousSibling.tag.type !== ShiftTag) {
          target = this.held.node;
        } else {
          // if (!this.node.flags.hasGap) throw new Error('Node must allow gaps');

          target = buildStubNode(tag);
        }

        this.held = null;

        const range = getRange(target);

        this.resultPath = range ? range[1] : this.resultPath;
        this.referenceTagPath = null;

        let lastRefPath = [ShiftTag, ReferenceTag].includes(lastTagPath.tag.type)
          ? lastTagPath
          : lastTagPath.previousSibling;

        if (![ShiftTag, ReferenceTag].includes(lastRefPath.tag.type)) throw new Error();

        if (lastRefPath.tag.type === ShiftTag) {
          shiftProperty(node, property);
        } else {
          addProperty(node, property);
        }

        break;
      }

      case GapTag:
      case NullTag: {
        const { node: parentNode, referenceTag } = this;

        if (this.held) throw new Error();

        if (!this.atReference && this.parent) {
          throw new Error('Invalid location for NullTag');
        }

        let stubNode = buildStubNode(tag);

        add(parentNode, referenceTag, stubNode);

        targetPath = this.path.push(stubNode, sumtree.getSize(this.node.children) - 3);
        break;
      }

      case AttributeDefinition: {
        let { path, value } = tag.value;

        if (this.held) throw new Error('invalid place for an atrribute binding');

        this.node.children = sumtree.push(this.node.children, tag);

        let nodeState = nodeStates.get(this.node);

        nodeState.undefinedAttributes--;

        // add undefined attributes from value

        defineAttribute(this.node, path, value);

        break;
      }

      case InitializerTag: {
        const { isArray } = tag.value;
        const { node, referenceTag } = this;
        const { name } = referenceTag.value;

        if (!this.atReference && this.parent) {
          throw new Error('Invalid location for OpenNodeTag');
        }

        if (this.held && sumtree.getAt(2, node.children)?.type === InitializerTag) {
          throw new Error();
        }

        if (
          hasOwn(node.properties, name) &&
          (isArray
            ? btree.getSize(node.properties[name])
            : node.properties[name]?.node === undefined)
        ) {
          throw new Error();
        }

        add(node, referenceTag, isArray ? [] : undefined);
        break;
      }

      case ShiftTag: {
        if (this.resultPath.tag.type !== Property) throw new Error('invalid location for shift');

        let heldProperty = this.resultPath.tag.value;

        if (!this.held) {
          this.held = heldProperty;
        }

        if (!heldProperty.reference.flags.expression) throw new Error();

        this.node.children = sumtree.push(this.node.children, tag);

        this.referenceTagPath = TagPath.from(this.path, -1);

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

    this.resultPath = targetPath && TagPath.from(targetPath, -1);

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

  get referenceTag() {
    return this.referenceTagPath?.tag;
  }

  get bindingPath() {
    let path = this.referenceTagPath.nextSibling;
    return path.tag.type === BindingTag ? path : null;
  }

  get binding() {
    return this.bindingPath?.tag;
  }

  get node() {
    return this.path?.node;
  }
};
