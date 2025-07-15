import emptyStack from '@iter-tools/imm-stack';
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
  buildAttributeDefinition,
  buildBinding,
  buildGapTag,
  getOr,
  has as nodeHas,
  buildReferenceTag,
  buildReference,
} from '@bablr/agast-helpers/tree';
import * as sumtree from '@bablr/agast-helpers/children';
import * as btree from '@bablr/agast-helpers/btree';
import {
  getInitializerChildrenIndex,
  getOpenTag,
  getOriginalFirstNode,
  getProperty,
  getPropertyChildrenIndex,
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

const defineAttribute = (node, tag) => {
  if (tag.type !== AttributeDefinition) throw new Error();

  let { path, value } = tag.value;
  let openTag = getOpenTag(node);
  let { attributes } = node;

  if (!has(attributes, path) && get(attributes, path) !== undefined)
    throw new Error('Can only define undefined attributes');

  if (value === undefined) throw new Error('cannot define attribute to undefined');

  let { flags, type } = openTag.value;
  attributes = immSet(attributes, path, value);
  let newOpenTag = buildOpenNodeTag(flags, type, attributes);

  node.attributes = attributes;

  node.children = sumtree.replaceAt(0, node.children, newOpenTag);
  node.children = sumtree.push(node.children, tag);
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
        if (type === '@' && isArray) throw new Error();

        if (this.held && sumtree.getAt(2, this.node.children)?.type === InitializerTag) {
          if (
            !referencesAreEqual(sumtree.getAt(1, this.node.children).value, tag.value) ||
            sumtree.getSize(this.node.children) > 3
          ) {
            throw new Error();
          }
        }

        if (tag.value.name) {
          if (
            getOr(null, tag.value.name, this.node) &&
            !referencesAreEqual(tag.value, getProperty(tag.value.name, this.node).reference)
          ) {
            throw new Error('mismatched references');
          }
        } else if (tag.value.type === '.') {
          let rootIdx = getPropertyChildrenIndex(this.node, '.', null, 0);

          if (
            rootIdx != null &&
            !referencesAreEqual(tag.value, sumtree.getAt(rootIdx, this.node.children).value)
          ) {
            throw new Error('mismatched references');
          }
        }

        if (name && getOr(0, name, this.node) === undefined) {
          let existingReferenceIndex = getInitializerChildrenIndex(this.node, tag);
          let existingReferenceTag = sumtree.getAt(existingReferenceIndex, this.node.children);
          if (!referencesAreEqual(tag.value, existingReferenceTag.value)) {
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

          if (!tag.value.type && this.doctype) {
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

        nodeStates.set(this.node, { undefinedAttributes });

        break;
      }

      case CloseNodeTag: {
        if (this.atReference) throw new Error('invalid location for close tag');

        if (this.node.type) {
          for (const { 0: key, 1: count } of Object.entries(
            sumtree.getSums(this.node.children).references,
          )) {
            if (count === 1) {
              let property = getProperty(key, this.node);
              if (!property && nodeHas(key, this.node)) {
                let refIndex = getInitializerChildrenIndex(this.node, buildReferenceTag(null, key));
                let ref = sumtree.getAt(refIndex, this.node.children);
                if (!ref.value.isArray) {
                  let reference = sumtree.getAt(refIndex, this.node.children).value;

                  addProperty(this.node, buildProperty(reference, buildBinding(), buildNullNode()));
                }
              }
            }
          }
        }

        let path = emptyStack;
        let queue = [this.node.attributes];
        while (queue.length) {
          for (const { 0: key, 1: value } of Object.entries(queue[queue.length - 1])) {
            if (value === undefined) {
              path = path.push(key);
              defineAttribute(this.node, buildAttributeDefinition([...path], null));
              path = path.pop(key);
            } else if (isArray(value) || isObject(value)) {
              queue.push(value);
              path = path.push(key);
            }
          }
          queue.pop();
        }

        this.node.children = sumtree.push(this.node.children, tag);

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
            property = buildProperty(property.reference, this.held.binding, this.held.node);
          } else {
            let { height } = lastTagPath.previousSibling.tag.value;
            let matchesHeld =
              isGapNode(property.node) ||
              this.held.node === property.node ||
              this.held.node === getOriginalFirstNode(property.node, (height ?? 1) - 1);
            if (!matchesHeld) {
              throw new Error();
            }
          }

          node.leftStack = btree.replaceAt(-1, node.leftStack, property);
          node.leftStack = btree.push(
            node.leftStack,
            buildProperty(buildReference('.'), buildBinding(), buildStubNode(buildGapTag())),
          );
        }

        target = this.held ? this.held.node : buildStubNode(buildGapTag());

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

        this.held = null;
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
        if (this.held) throw new Error('invalid place for an atrribute binding');

        let nodeState = nodeStates.get(this.node);

        nodeState.undefinedAttributes--;

        // add undefined attributes from value

        defineAttribute(this.node, tag);

        break;
      }

      case InitializerTag: {
        const { isArray } = tag.value;
        const { node, referenceTag } = this;

        if (!this.atReference && this.parent) {
          throw new Error('Invalid location for InitializerTag');
        }

        if (this.held && sumtree.getAt(2, node.children)?.type === InitializerTag) {
          throw new Error();
        }

        if (getInitializerChildrenIndex(node, referenceTag) != null) {
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
