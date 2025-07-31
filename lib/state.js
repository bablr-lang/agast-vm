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
  buildBounds,
  buildChild,
  buildPropertyWrapper,
} from '@bablr/agast-helpers/tree';
import * as Tags from '@bablr/agast-helpers/tags';
import * as BTree from '@bablr/agast-helpers/btree';
import {
  getInitializerTagsIndex,
  getOpenTag,
  getOriginalFirstNode,
  getProperty,
  getPropertyTagsIndex,
  isGapNode,
  isStubNode,
  offsetForTag,
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
  PropertyWrapper,
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

  node.tags = Tags.replaceAt(0, node.tags, newOpenTag);
  node.tags = Tags.push(node.tags, tag);
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

        if (this.held && Tags.getAt(2, this.node.tags)?.type === InitializerTag) {
          if (
            !referencesAreEqual(Tags.getAt(1, this.node.tags).value, tag.value) ||
            Tags.getSize(this.node.tags) > 3
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
          let rootIdx = getPropertyTagsIndex(this.node, '.', null, 0);

          if (
            rootIdx != null &&
            !referencesAreEqual(
              tag.value,
              Tags.getAt(rootIdx, this.node.tags).value.property.reference,
            )
          ) {
            throw new Error('mismatched references');
          }
        }

        let initIndex = getInitializerTagsIndex(this.node, tag);
        if (initIndex != null) {
          let initReferenceTag = Tags.getAt(initIndex, this.node.tags, 0);
          if (!referencesAreEqual(tag.value, initReferenceTag.value)) {
            throw new Error("reference didn't match initializer");
          }
        }

        let tagProperty = buildProperty(tag.value);

        this.node.tags = Tags.push(
          this.node.tags,
          buildChild(PropertyWrapper, buildPropertyWrapper([tag], tagProperty)),
        );

        if (flags.hasGap && !this.node.flags.hasGap) {
          throw new Error('gap reference in gapless node');
        }

        this.referenceTagPath = TagPath.from(this.path, -1, 0);

        break;
      }

      case BindingTag: {
        if (!this.atReference && this.parent) {
          throw new Error('Invalid location for BindingTag');
        }

        let refPath = this.referenceTagPath;
        let propPath = TagPath.from(refPath.path, refPath.tagsIndex);

        if (refPath.tag.type === ShiftTag) {
          refPath = TagPath.from(refPath.path, refPath.tagsIndex - refPath.tag.value.index, 0);
        }

        let refTag = refPath.tag;

        let tagProperty = buildProperty(refTag.value, tag.value, undefined);
        let tags = [propPath.tag.value.tags[0], tag];

        this.node.tags = Tags.replaceAt(
          this.referenceTagPath.tagsIndex,
          this.node.tags,
          buildChild(PropertyWrapper, buildPropertyWrapper(tags, tagProperty)),
        );
        break;
      }

      case OpenNodeTag: {
        let { literalValue } = tag.value;
        let parentNode = this.node;

        if (!this.atBinding && this.parent) {
          throw new Error('Invalid location for OpenNodeTag');
        }

        let bindingTag = parentNode && Tags.getAt(-1, parentNode.tags, 1);

        if (bindingTag && !bindingTag.value.languagePath) throw new Error();

        let node = createNode(tag);

        if (!this.path) {
          this.path = Path.create(node);
        } else {
          this.path = this.path.push(node, Tags.getSize(parentNode.tags) - 1);
          add(parentNode, this.referenceTag, node, bindingTag);
        }

        if (literalValue) {
          finalizeNode(node);

          let oldPath = this.path;
          this.path = this.path.parent;

          if (!this.path) {
            this.done = true;
            this.resultPath = TagPath.from(oldPath, 0);
            return tag;
          }
        }

        targetPath = this.path;

        if (this.path) {
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
        }

        break;
      }

      case CloseNodeTag: {
        if (this.atReference) throw new Error('invalid location for close tag');

        if (this.node.type) {
          for (const { 0: key, 1: count } of Tags.getSums(this.node.tags).references) {
            if (count === 1) {
              let property = getProperty(key, this.node);
              if (!property && nodeHas(key, this.node)) {
                let refIndex = getInitializerTagsIndex(this.node, buildReferenceTag(null, key));
                let ref = Tags.getAt(refIndex, this.node.tags, 0);
                if (!ref.value.isArray) {
                  let reference = Tags.getAt(refIndex, this.node.tags, 0).value;

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

        this.node.tags = Tags.push(this.node.tags, tag);

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

        if (!this.atBinding && !isStubNode(property.node)) {
          throw new Error('Invalid location for Property');
        }

        let { node } = this.path;
        let lastTagPath = TagPath.from(this.path, -1, 0);
        let refOrShift = lastTagPath.tag;

        if (![ShiftTag, ReferenceTag].includes(refOrShift.type)) throw new Error();

        if (this.held) {
          if (isGapNode(property.node)) {
            property = buildProperty(property.reference, this.held.binding, this.held.node);
          } else {
            let { height } = refOrShift.value;
            let matchesHeld =
              isGapNode(property.node) ||
              this.held.node === property.node ||
              this.held.node === getOriginalFirstNode(property.node, (height ?? 1) - 1);
            if (!matchesHeld) {
              throw new Error();
            }
          }

          let openStack = node.bounds[0];

          openStack = BTree.replaceAt(-1, openStack, property);
          openStack = BTree.push(
            openStack,
            buildProperty(buildReference('.'), buildBinding(), buildStubNode(buildGapTag())),
          );

          node.bounds = buildBounds(openStack, node.bounds[1]);
        }

        target = this.held ? this.held.node : buildStubNode(buildGapTag());

        const range = getRange(target);

        this.resultPath = range ? range[1] : this.resultPath;
        this.referenceTagPath = null;

        if (refOrShift.type === ShiftTag) {
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

        targetPath = this.path.push(stubNode, Tags.getSize(this.node.tags) - 1);
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
        const { node, referenceTag } = this;

        if (!this.atReference && this.parent) {
          throw new Error('Invalid location for InitializerTag');
        }

        if (this.held && Tags.getAt(1, node.tags, 0)?.type === InitializerTag) {
          throw new Error();
        }

        if (getInitializerTagsIndex(node, referenceTag) != null) {
          throw new Error();
        }

        let currentProperty = Tags.getAt(-1, node.tags).value.property;

        let tags = [referenceTag, tag];

        let propertyWrapper = buildChild(
          PropertyWrapper,
          buildPropertyWrapper(tags, currentProperty),
        );

        node.tags = Tags.replaceAt(-1, node.tags, propertyWrapper);
        break;
      }

      case ShiftTag: {
        if (this.resultPath.tag.type !== Property) throw new Error('invalid location for shift');

        let heldProperty = this.resultPath.tag.value;

        if (!this.held) {
          this.held = heldProperty;
        }

        if (!heldProperty.reference.flags.expression) throw new Error();

        let tagProperty = buildProperty(heldProperty.reference);

        this.node.tags = Tags.push(
          this.node.tags,
          buildChild(PropertyWrapper, buildPropertyWrapper([tag], tagProperty)),
        );

        this.referenceTagPath = TagPath.from(this.path, -1, 0);

        // this.path = finishedPath;
        targetPath = this.path;
        break;
      }

      case LiteralTag:
        if (typeof tag.value !== 'string') throw new Error();

        this.node.tags = Tags.push(this.node.tags, tag);
        break;

      default:
        throw new Error();
    }

    this.resultPath =
      targetPath && TagPath.from(targetPath, -1, tag.type === Property ? -1 : offsetForTag(tag));

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
