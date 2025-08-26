import { Property } from '@bablr/agast-helpers/symbols';
import { NodeFacade, actuals } from './node.js';
import { Path, TagPath } from '@bablr/agast-helpers/path';
import { buildChild, buildFacadeProperty } from '@bablr/agast-helpers/builders';

export { Path, TagPath } from '@bablr/agast-helpers/path';

export { allTagPathsFor, ownTagPathsFor } from '@bablr/agast-helpers/path';

let { freeze } = Object;

let paths = new WeakMap();

export class TagPathFacade {
  static from(path, tagsIndex, wrapperIndex) {
    let tagPath = path && TagPath.from(paths.get(path), tagsIndex, wrapperIndex);
    return tagPath && new TagPathFacade(tagPath);
  }

  static fromNode(node, tagsIndex, wrapperIndex) {
    let path = node && TagPath.fromNode(actuals.get(node), tagsIndex, wrapperIndex);
    return path && new TagPathFacade(path);
  }

  static wrap(tagPath) {
    return tagPath && new TagPathFacade(tagPath);
  }

  constructor(tagPath) {
    if (!(tagPath instanceof TagPath)) throw new Error();
    paths.set(this, tagPath);

    let { tag } = tagPath;

    this.path = new PathFacade(tagPath.path);
    this.node = new NodeFacade(tagPath.node);
    this.tag =
      tag.type === Property
        ? buildChild(
            Property,
            buildFacadeProperty(
              tag.value.reference,
              tag.value.binding,
              new NodeFacade(tag.value.node),
            ),
          )
        : tag;
    this.tagsIndex = tagPath.tagsIndex;
    this.wrapperIndex = tagPath.wrapperIndex;

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

  get propertyWrapper() {
    return TagPathFacade.wrap(paths.get(this).propertyWrapper);
  }

  equalTo(tagPath) {
    if (tagPath == null) return false;

    let { path, tagsIndex, wrapperIndex } = paths.get(this);
    let tagPath_ = paths.get(tagPath);
    return (
      path.node === tagPath_.path.node &&
      tagsIndex === tagPath_.tagsIndex &&
      wrapperIndex === tagPath_.wrapperIndex
    );
  }
}

export class PathFacade {
  static from(node) {
    return node && new PathFacade(Path.from(actuals.get(node)));
  }

  static wrap(path) {
    return path && new PathFacade(path);
  }

  constructor(path) {
    if (!(path instanceof Path)) throw new Error();
    this.depth = path.depth;

    this.node = new NodeFacade(path.node);
    this.parentIndex = path.parentIndex;

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

  get bindingTag() {
    return paths.get(this).bindingTag;
  }

  get binding() {
    return paths.get(this).binding;
  }

  get bindingTagPath() {
    return TagPathFacade.wrap(paths.get(this).bindingTagPath);
  }

  get parentProperty() {
    return this.parentPropertyPath.tag;
  }

  get parentPropertyPath() {
    return TagPathFacade.wrap(paths.get(this).parentPropertyPath);
  }

  get referenceTag() {
    return paths.get(this).referenceTag;
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

  tagPathAt(tagsIndex, wrapperIndex) {
    return TagPathFacade.wrap(TagPath.from(paths.get(this), tagsIndex, wrapperIndex));
  }

  tagAt(tagsIndex, wrapperIndex) {
    return this.tagPathAt(tagsIndex, wrapperIndex).tag;
  }

  atDepth(depth) {
    return new PathFacade(paths.get(this).atDepth(depth));
  }
}
