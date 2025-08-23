import {
  buildPathSegment,
  get,
  has,
  countList,
  getChildPropertyIndex,
  getCloseTag,
  getInitializerTagsIndex,
  getProperty,
  getPropertyTagsIndex,
  relatedNodes,
  getOpenTag,
} from '@bablr/agast-helpers/path';
import * as Tags from '@bablr/agast-helpers/tags';
import * as BTree from '@bablr/agast-helpers/btree';
import { CloseNodeTag, GapTag, NullTag, OpenNodeTag } from '@bablr/agast-helpers/symbols';
import { buildReferenceTag, nodeFlags } from '@bablr/agast-helpers/builders';
import { nodeStates } from './state.js';

let { freeze } = Object;

export const actuals = new WeakMap();

export class BTreeNodeFacade {}

export class NodeTagsFacade {
  constructor(node) {
    actuals.set(this, node);

    if (!Object.isFrozen(node)) throw new Error(); // just a sanity check right now

    let nodeValues = Tags.getValues(node);

    this.openTag = nodeValues[0];
    this.children = nodeValues[1];
    this.closeTag = nodeValues[2];

    this.size = Tags.getSize(node);
    this.node = node;

    freeze(this);
  }

  *children() {
    for (const child of this) {
      if (![OpenNodeTag, CloseNodeTag, NullTag, GapTag].includes(child.type)) {
        yield child;
      }
    }
  }

  at(idx, offsetIdx) {
    return Tags.getAt(idx, this.node, offsetIdx);
  }

  find(reference, index) {
    let node = this.node;

    let idx = this.findIndex(reference, index);

    return idx == null ? null : Tags.getAt(idx, node);
  }

  findIndex(reference, index) {
    let { type, name } = reference;

    return getPropertyTagsIndex(this.node, type, name, index);
  }

  [Symbol.iterator]() {
    return Tags.traverse(this.node);
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

export class PropertyWrapperFacade {
  constructor(propertyWrapper) {
    actuals.set(this, propertyWrapper);

    freeze(this);
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
    return (
      !!getProperty(path, actuals.get(this)) ||
      getInitializerTagsIndex(actuals.get(this), buildReferenceTag(null, name)) != null
    );
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
    return NodeFacade.from(has(path, actuals.get(this)));
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
