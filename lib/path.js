import { NodeFacade, nodes } from './node.js';
import { Path, TagPath } from '@bablr/agast-helpers/path';

export { Path, TagPath } from '@bablr/agast-helpers/path';

export { allTagPathsFor, ownTagPathsFor } from '@bablr/agast-helpers/path';

let { freeze } = Object;

let paths = new WeakMap();

export class TagPathFacade {
  static from(path, childrenIndex) {
    return path && new TagPathFacade(TagPath.from(paths.get(path), childrenIndex));
  }

  static fromNode(node, childrenIndex) {
    let path = node && TagPath.fromNode(nodes.get(node), childrenIndex);
    return path && new TagPathFacade(path);
  }

  static wrap(tagPath) {
    return tagPath && new TagPathFacade(tagPath);
  }

  constructor(tagPath) {
    if (!(tagPath instanceof TagPath)) throw new Error();
    paths.set(this, tagPath);

    this.path = new PathFacade(tagPath.path);
    this.node = new NodeFacade(tagPath.node);
    this.tag = tagPath.tag;
    this.childrenIndex = tagPath.childrenIndex;

    freeze(this);
  }

  get child() {
    return this.tag;
  }

  siblingAt(index) {
    return TagPathFacade.wrap(paths.get(this).siblingAt(index));
  }

  get nextSibling() {
    return TagPathFacade.wrap(paths.get(this).nextSibling);
  }

  get next() {
    return TagPathFacade.wrap(paths.get(this).next);
  }

  get nextUnshifted() {
    return TagPathFacade.wrap(paths.get(this).nextUnshifted);
  }

  get previousSibling() {
    return TagPathFacade.wrap(paths.get(this).previousSibling);
  }

  get previous() {
    return TagPathFacade.wrap(paths.get(this).previous);
  }

  get previousUnshifted() {
    return TagPathFacade.wrap(paths.get(this).previousUnshifted);
  }

  get inner() {
    return PathFacade.wrap(paths.get(this).inner);
  }

  equalTo(tagPath) {
    if (tagPath == null) return false;

    let { path, childrenIndex } = paths.get(this);
    let tagPath_ = paths.get(tagPath);
    return path.node === tagPath_.path.node && childrenIndex === tagPath_.childrenIndex;
  }
}

export class PathFacade {
  static from(node) {
    return node && new PathFacade(Path.from(nodes.get(node)));
  }

  static wrap(path) {
    return path && new PathFacade(path);
  }

  constructor(path) {
    if (!(path instanceof Path)) throw new Error();
    this.depth = path.depth;

    this.node = new NodeFacade(path.node);
    this.referenceIndex = path.referenceIndex;

    paths.set(this, path);

    freeze(this);
  }

  get parent() {
    // not a stable reference. can/should it be?
    return PathFacade.wrap(paths.get(this).parent);
  }

  get openTagPath() {
    return TagPathFacade.wrap(paths.get(this).openTagPath);
  }

  get openTag() {
    return paths.get(this).openTag;
  }

  get closeTagPath() {
    return TagPathFacade.wrap(paths.get(this).closeTagPath);
  }

  get closeTag() {
    return paths.get(this).closeTag;
  }

  get reference() {
    return paths.get(this).reference;
  }

  get referenceTagPath() {
    return TagPathFacade.wrap(paths.get(this).referenceTagPath);
  }

  get(path, shiftIndex = null) {
    return new PathFacade(paths.get(this).get(path, shiftIndex));
  }

  tagPathAt(childrenIndex) {
    return TagPathFacade.wrap(TagPath.from(paths.get(this), childrenIndex));
  }

  tagAt(childrenIndex) {
    return this.tagPathAt(childrenIndex).tag;
  }

  atDepth(depth) {
    return new PathFacade(paths.get(this).atDepth(depth));
  }
}
