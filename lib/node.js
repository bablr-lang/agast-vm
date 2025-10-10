import {
  buildPathSegment,
  get,
  has,
  countList,
  getChildPropertyIndex,
  getCloseTag,
  getProperty,
  getPropertyTagsIndex,
  relatedNodes,
  getOpenTag,
} from '@bablr/agast-helpers/path';
import * as Tags from '@bablr/agast-helpers/tags';
import * as BTree from '@bablr/agast-helpers/btree';
import {
  GapTag,
  NullTag,
  OpenNodeTag,
  Property,
  PropertyWrapper,
} from '@bablr/agast-helpers/symbols';
import {
  buildChild,
  buildFacadeProperty,
  buildPropertyWrapper,
  nodeFlags,
} from '@bablr/agast-helpers/builders';
import { nodeStates } from './state.js';
import { flatMap } from '@bablr/agast-helpers/stream';

let { freeze } = Object;

export const actuals = new WeakMap();

let wrapTag = (tag) => {
  switch (tag.type) {
    case Property: {
      let { reference, binding, node, shift } = tag.value;
      return buildChild(
        Property,
        buildFacadeProperty(reference, binding, NodeFacade.from(node), shift),
      );
    }
    case PropertyWrapper:
      let { property, tags } = tag.value;
      let { reference, binding, node, shift } = property;
      return buildChild(
        PropertyWrapper,
        buildPropertyWrapper(
          tags.map(wrapTag),
          buildFacadeProperty(reference, binding, NodeFacade.from(node), shift),
        ),
      );
    default:
      return tag;
  }
};

export class NodeTagsFacade {
  constructor(node) {
    actuals.set(this, node);

    if (!Object.isFrozen(node)) throw new Error(); // just a sanity check right now

    this.size = Tags.getSize(node);
    this.node = node;
    this.values = Tags.getValues(node);
    this.sums = Tags.getSums(node);

    freeze(this);
  }

  at(idx, offsetIdx) {
    return wrapTag(Tags.getAt(idx, this.node, offsetIdx));
  }

  find(reference, index) {
    let node = this.node;

    let idx = this.findIndex(reference, index);

    return idx == null ? null : wrapTag(Tags.getAt(idx, node));
  }

  findIndex(reference, index) {
    let { type, name } = reference;

    return getPropertyTagsIndex(this.node, type, name, index);
  }

  [Symbol.iterator]() {
    return flatMap((tag) => [wrapTag(tag)], Tags.traverse(this.node))[Symbol.iterator]();
  }
}

export class ListFacade {
  constructor(tree) {
    actuals.set(this, tree);

    this.size = BTree.getSize(tree);

    freeze(this);
  }

  at(idx) {
    return BTree.getAt(idx, actuals.get(this));
  }

  [Symbol.iterator]() {
    return BTree.traverse(actuals.get(this));
  }
}

export class NodePropertiesFacade {
  constructor(node) {
    actuals.set(this, node);

    freeze(this);
  }

  get(name, index = undefined, shiftIndex = undefined) {
    let node = actuals.get(this);

    let prop = getProperty(buildPathSegment(name, index, shiftIndex), node);
    if (prop) {
      if (Array.isArray(prop.node) && index === undefined) {
        return new ListFacade(prop.node);
      }

      if (Array.isArray(prop.node)) {
        prop = BTree.getAt(index ?? -1, prop.node);
      }

      if (!prop) return index === -1 ? prop : null;

      return NodeFacade.from(prop.node);
    }
    return null;
  }

  referenceAt(name, index = undefined) {
    let path = index == null ? name : buildPathSegment(name, index);
    return getProperty(path, actuals.get(this))?.reference;
  }

  has(name, index = undefined) {
    let path = index == null ? name : buildPathSegment(name, index);
    return !!getProperty(path, actuals.get(this));
  }

  [Symbol.iterator]() {
    return relatedNodes(actuals.get(this));
  }
}

export class NodeFacade {
  static from(node) {
    return node && new NodeFacade(node);
  }

  constructor(node) {
    let sigilTag = getOpenTag(node);

    this.sigilTag = sigilTag;

    if ([NullTag, GapTag].includes(sigilTag.type)) {
      this.flags = nodeFlags;
      this.type = null;
    } else if (sigilTag.type === OpenNodeTag) {
      let { flags, type } = sigilTag.value;

      this.flags = flags;
      this.type = type;
    } else {
      throw new Error();
    }

    actuals.set(this, node);

    freeze(this);
  }

  get tags() {
    return new NodeTagsFacade(actuals.get(this).tags);
  }

  get openTag() {
    return actuals.get(this).tags[1][0];
  }

  get closeTag() {
    return actuals.get(this).tags[1][2];
  }

  get children() {
    return new NodeTagsFacade(actuals.get(this).children);
  }

  get properties() {
    return new NodePropertiesFacade(actuals.get(this));
  }

  get attributes() {
    return actuals.get(this).attributes;
  }

  get undefinedAttributes() {
    return nodeStates.get(actuals.get(this)).undefinedAttributes;
  }

  get node() {
    let node = actuals.get(this);

    let openTag = getOpenTag(node);

    return getCloseTag(node) ||
      (openTag && ([NullTag, GapTag].includes(openTag.type) || openTag.value.literalValue))
      ? node
      : undefined;
  }

  get(path) {
    return NodeFacade.from(get(path, actuals.get(this)));
  }

  has(path) {
    return has(path, actuals.get(this));
  }

  countList(path) {
    return countList(path, actuals.get(this));
  }

  getChildPropertyIndex(tagsIndex) {
    return getChildPropertyIndex(actuals.get(this), tagsIndex);
  }

  getPropertyTagsIndex(type, name) {
    return getPropertyTagsIndex(actuals.get(this), type, name);
  }

  equalTo(node) {
    return actuals.get(this) === actuals.get(node);
  }
}
