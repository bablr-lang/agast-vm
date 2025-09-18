/* global WeakSet */
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
  Node,
} from '@bablr/agast-helpers/symbols';
import { nodeStates, State } from './state.js';
import { facades } from './facades.js';
import { getFirstNode, Path, TagPath, wrapperIsFull } from '@bablr/agast-helpers/path';
import * as Tags from '@bablr/agast-helpers/tags';
import * as BTree from '@bablr/agast-helpers/btree';
import { actuals, NodeFacade } from './node.js';
import {
  buildBinding,
  buildGapTag,
  buildNodeTag,
  buildProperty,
  buildReference,
} from '@bablr/agast-helpers/builders';
import { buildBounds, buildStubNode } from '@bablr/agast-helpers/tree';
import { isObject } from '@bablr/agast-helpers/object';

const validNodes = new WeakSet();

export const isKnownValid = (node) => validNodes.has(node);

let { isArray } = Array;

export const agast = (options = {}) => {
  let state = State.from(options.held);

  let vm = __agast(state, options);

  vm.next();

  Object.freeze(options);

  return Object.freeze({ options, state: facades.get(state), vm });
};

function* __agast(s) {
  let tag = yield;
  for (;;) {
    let returnValue = null;

    if (s.resultPath && !s.path) {
      throw new Error('Cannot advance after completion');
    }

    // if (
    //   s.held &&
    //   ![
    //     OpenNodeTag,
    //     ReferenceTag,
    //     InitializerTag,
    //     Property,
    //     Node,
    //     BindingTag,
    //     PropertyWrapper,
    //     GapTag,
    //   ].includes(tag.type) &&
    //   !(
    //     (tag.type === Property &&
    //       (Tags.getSize(tag.value.node.tags) <= 1 || getFirstNode(tag.value.node) === s.held)) ||
    //     tag.value.node === s.held
    //   )
    // ) {
    //   throw new Error('Cannot advance while holding');
    // }

    switch (tag.type) {
      case DoctypeTag: {
        if (s.path) {
          throw new Error();
        }

        s.advance(tag);
        break;
      }

      case ReferenceTag: {
        s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        s.referenceTagPath = TagPath.from(s.path, -1, 0);
        break;
      }

      case LiteralTag: {
        s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        break;
      }

      case InitializerTag: {
        s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        s.referenceTagPath = null;
        break;
      }

      case AttributeDefinition: {
        let nodeState = nodeStates.get(s.node);

        nodeState.undefinedAttributes--;

        s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        s.referenceTagPath = TagPath.from(s.path, -1, 0);
        break;
      }

      case BindingTag: {
        const { languagePath } = tag.value;

        if (languagePath && !isArray(languagePath)) throw new Error();

        s.path = s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        break;
      }

      case NullTag:
      case GapTag: {
        s.path = s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        returnValue = new NodeFacade(s.resultPath.node);
        break;
      }

      case AttributeDefinition: {
        if (s.atReference) throw new Error();

        s.advance(tag);
        break;
      }

      case InitializerTag: {
        if (!s.atReference) throw new Error();

        s.advance(tag);
        break;
      }

      case ShiftTag: {
        s.path = s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        s.referenceTagPath = TagPath.from(s.path, -1, 0);
        break;
      }

      case OpenNodeTag: {
        s.path = !s.path ? TagPath.fromTag(tag).path : s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);

        if (s.path) {
          let undefinedAttributes = 0;

          let queue = [s.node.attributes];
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

          nodeStates.set(s.node, { undefinedAttributes });
        }

        returnValue = new NodeFacade(s.node || s.resultPath.node);
        break;
      }

      case CloseNodeTag: {
        if (!s.path) {
          s.done = true;
        }

        validNodes.add(s.node);

        returnValue = new NodeFacade(s.node);

        s.resultPath = s.path.tagPathAt(-1, -1);
        s.path = s.path.advance(tag);
        break;
      }

      case PropertyWrapper: {
        let { tags, property } = tag.value;
        let { node, reference } = property;

        if (reference.type === '_') {
          returnValue = node;

          let existingProperty = Tags.getAt(-1, s.node.children);

          if (existingProperty && !wrapperIsFull(existingProperty)) {
            throw new Error('not implemented');
          }

          s.node.tags = Tags.push(s.node.tags, node);
          s.node.children = s.node.tags[1][1];

          s.resultPath = TagPath.from(s.path, -1, -1);
          if (Tags.getAt(-1, s.node.tags).type === PropertyWrapper) {
            s.referenceTagPath = TagPath.from(s.path, -1, 0);
          }
          s.held = null;

          if (
            existingProperty?.value.property.reference.flags.expression ||
            Tags.getAt(0, node)?.value.property.reference.flags.expression
          ) {
            let openStack = s.node.bounds[0];
            let path = Path.from(s.node);
            let lastTagPath = TagPath.from(path, -1, 0);
            if ([ReferenceTag, ShiftTag].includes(lastTagPath?.tag.type)) {
              let lastRefPath =
                lastTagPath.tag.type === ReferenceTag
                  ? lastTagPath
                  : TagPath.from(
                      path,
                      -1 - lastTagPath.propertyWrapper.tag.value.property.shift.index,
                      0,
                    );
              let { firstPropertyTagPath } = path;
              let isFirstProperty =
                !!firstPropertyTagPath && lastRefPath.propertyWrapper.equalTo(firstPropertyTagPath);
              if (isFirstProperty) {
                openStack = BTree.pop(openStack);

                for (let i = 0; i < Tags.getSize(node); i++) {
                  let tag = Tags.getAt(i, node);
                  if (
                    (existingProperty && tag.value.tags[0].type !== ShiftTag) ||
                    !wrapperIsFull(tag)
                  ) {
                    break;
                  }

                  existingProperty = tag.value.property;
                  openStack = BTree.push(openStack, tag.value.property);
                }

                openStack = BTree.push(
                  openStack,
                  buildProperty(buildReference('.'), buildBinding(), buildStubNode(buildGapTag())),
                );
                s.node.bounds = buildBounds(openStack, s.node.bounds[1]);
              }
            }
          }
        } else {
          for (tag of tags) {
            s.advance(tag);
          }
          returnValue = new NodeFacade(node);
        }

        break;
      }

      case Property: {
        let { node } = tag.value;

        s.path.advance(tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        s.referenceTagPath = null;
        s.held = null;

        returnValue = Array.isArray(node) ? node : new NodeFacade(node);
        break;
      }

      case Node: {
        let node = tag.value;

        s.path.advance(s.held ? buildNodeTag(s.held) : tag);
        s.resultPath = s.path.tagPathAt(-1, -1);
        s.referenceTagPath = null;
        s.held = null;

        returnValue = Array.isArray(node) ? node : new NodeFacade(node);
        break;
      }

      default:
        throw new Error();
    }

    tag = yield returnValue;
  }
}
