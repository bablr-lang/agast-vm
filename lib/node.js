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

export const nodes = new WeakMap();

export class BTreeNodeFacade {}

export class NodeTagsFacade {
  constructor(node) {
    nodes.set(this, node);

    if (!Object.isFrozen(node)) throw new Error(); // just a sanity check right now

    let nodeValues = Tags.getValues(node);

    this.openTag = nodeValues[0];
    this.childrenNode = nodeValues[1];
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
    nodes.set(this, tree);

    this.size = BTree.getSize(tree);

    freeze(this);
  }

  at(idx) {
    return BTree.getAt(idx, nodes.get(this));
  }

  [Symbol.iterator]() {
    return BTree.traverse(nodes.get(this));
  }
}

export class NodePropertiesFacade {
  constructor(node) {
    nodes.set(this, node);

    freeze(this);
  }

  get(name, index = undefined, shiftIndex = undefined) {
    let node = nodes.get(this);

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
    return getProperty(path, nodes.get(this))?.reference;
  }

  has(name, index = undefined) {
    let path = index == null ? name : buildPathSegment(name, index);
    return (
      !!getProperty(path, nodes.get(this)) ||
      getInitializerTagsIndex(nodes.get(this), buildReferenceTag(null, name)) != null
    );
  }

  [Symbol.iterator]() {
    return relatedNodes(nodes.get(this));
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

    nodes.set(this, node);

    freeze(this);
  }

  get tags() {
    return new NodeTagsFacade(nodes.get(this).tags);
  }

  get properties() {
    return new NodePropertiesFacade(nodes.get(this));
  }

  get attributes() {
    return nodes.get(this).attributes;
  }

  get undefinedAttributes() {
    return nodeStates.get(nodes.get(this)).undefinedAttributes;
  }

  get node() {
    let node = nodes.get(this);

    return getCloseTag(node) || [NullTag, GapTag].includes(getOpenTag(node).type)
      ? node
      : undefined;
  }

  get(path) {
    return NodeFacade.from(get(path, nodes.get(this)));
  }

  has(path) {
    return NodeFacade.from(has(path, nodes.get(this)));
  }

  countList(path) {
    return countList(path, nodes.get(this));
  }

  getChildPropertyIndex(tagsIndex) {
    return getChildPropertyIndex(nodes.get(this), tagsIndex);
  }

  getPropertyTagsIndex(type, name) {
    return getPropertyTagsIndex(nodes.get(this), type, name);
  }

  equalTo(node) {
    return nodes.get(this) === nodes.get(node);
  }
}
