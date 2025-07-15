import {
  buildPathSegment,
  get,
  has,
  countList,
  getChildPropertyIndex,
  getCloseTag,
  getInitializerChildrenIndex,
  getProperty,
  getPropertyChildrenIndex,
  relatedNodes,
} from '@bablr/agast-helpers/path';
import * as sumtree from '@bablr/agast-helpers/children';
import * as btree from '@bablr/agast-helpers/btree';
import { DoctypeTag, GapTag, NullTag, OpenNodeTag } from '@bablr/agast-helpers/symbols';
import { buildReferenceTag, nodeFlags } from '@bablr/agast-helpers/builders';
import { nodeStates } from './state.js';

let { freeze } = Object;

export const nodes = new WeakMap();

export class NodeChildrenFacade {
  constructor(node) {
    nodes.set(this, node);
    let tree = node.children;

    if (!Object.isFrozen(tree)) throw new Error(); // just a sanity check right now

    this.size = sumtree.getSize(tree);

    freeze(this);
  }

  at(idx) {
    return sumtree.getAt(idx, nodes.get(this).children);
  }

  find(reference, index) {
    let node = nodes.get(this);

    let idx = this.findIndex(reference, index);

    return idx == null ? null : sumtree.getAt(idx, node.children);
  }

  findIndex(reference, index) {
    let { type, name } = reference;

    return getPropertyChildrenIndex(nodes.get(this), type, name, index);
  }

  [Symbol.iterator]() {
    return sumtree.traverse(nodes.get(this).children);
  }
}

export class ListFacade {
  constructor(tree) {
    nodes.set(this, tree);

    this.size = btree.getSize(tree);

    freeze(this);
  }

  at(idx) {
    return btree.getAt(idx, nodes.get(this));
  }

  [Symbol.iterator]() {
    return btree.traverse(nodes.get(this));
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
        prop = btree.getAt(index ?? -1, prop.node);
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
      getInitializerChildrenIndex(nodes.get(this), buildReferenceTag(null, name)) != null
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
    let sigilTag = sumtree.getAt(0, node.children);

    if (sigilTag.type === DoctypeTag) {
      sigilTag = sumtree.getAt(1, node.children);
    }

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

  get children() {
    return new NodeChildrenFacade(nodes.get(this));
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

    return getCloseTag(node) || [NullTag, GapTag].includes(sumtree.getAt(0, node.children).type)
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

  getChildPropertyIndex(childrenIndex) {
    return getChildPropertyIndex(nodes.get(this), childrenIndex);
  }

  getPropertyChildrenIndex(type, name) {
    return getPropertyChildrenIndex(nodes.get(this), type, name);
  }
}
