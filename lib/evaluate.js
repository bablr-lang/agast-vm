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
import { State } from './state.js';
import { facades } from './facades.js';
import { getFirstNode, TagPath } from '@bablr/agast-helpers/path';
import * as Tags from '@bablr/agast-helpers/tags';
import { NodeFacade } from './node.js';
import {
  buildCloseNodeTag,
  buildOpenNodeTag,
  tokenFragmentFlags,
} from '@bablr/agast-helpers/builders';

let { isArray } = Array;

export const agast = (options = {}) => {
  if (options.held?.tags) throw new Error();

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

    if (
      s.held &&
      ![
        OpenNodeTag,
        ReferenceTag,
        InitializerTag,
        Property,
        BindingTag,
        PropertyWrapper,
        GapTag,
      ].includes(tag.type) &&
      !(
        (tag.type === Property &&
          (Tags.getSize(tag.value.node.tags) <= 1 ||
            getFirstNode(tag.value.node) === s.held.node)) ||
        tag.value.node === s.held.node
      )
    ) {
      throw new Error('Cannot advance while holding');
    }

    switch (tag.type) {
      case DoctypeTag: {
        if (s.path) {
          throw new Error();
        }

        s.advance(tag);
        break;
      }

      case LiteralTag: {
        if (!s.node.flags.token) {
          throw new Error('literals must occur inside tokens');
        }

        if (s.held) {
          throw new Error('Cannot consume input while hold register is full');
        }

        s.advance(tag);
        break;
      }

      case ReferenceTag: {
        const { type } = tag.value;

        if (s.node?.flags.token && type !== '@') {
          throw new Error('A token node cannot contain a reference');
        }

        s.advance(tag);
        break;
      }

      case BindingTag: {
        const { languagePath } = tag.value;

        if (languagePath && !isArray(languagePath)) throw new Error();

        s.held = null;

        s.advance(tag);
        break;
      }

      case NullTag:
      case GapTag: {
        s.advance(tag);
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
        const { index, height } = tag.value;
        if (s.resultPath.tag.type !== Property) throw new Error();

        let { path, tagsIndex } = s.resultPath;

        let prevRef = TagPath.from(path, tagsIndex, 0);
        let refPath = prevRef;

        if (prevRef.tag.type === ShiftTag) {
          if (prevRef.tag.value.index + 1 !== index) throw new Error('bad shift index');
          if (prevRef.tag.value.height + 1 !== height) throw new Error('bad shift height');

          refPath = TagPath.from(path, tagsIndex + 1 - index, 0);
        }

        if (refPath.tag.type !== ReferenceTag) throw new Error();

        if (!refPath.tag.value.flags.expression) {
          throw new Error();
        }

        s.advance(tag);
        break;
      }

      case OpenNodeTag: {
        let { type, flags, literalValue, selfClosing, attributes } = tag.value;

        if (selfClosing && literalValue && !flags.token) {
          s.advance(buildOpenNodeTag(flags, type, attributes));
          s.advance(buildOpenNodeTag(tokenFragmentFlags, null, {}, literalValue, true));
          s.advance(buildCloseNodeTag());
        } else {
          s.advance(tag);
        }

        returnValue = new NodeFacade(s.node || s.resultPath.node);
        break;
      }

      case CloseNodeTag: {
        returnValue = new NodeFacade(s.node);

        s.advance(tag);
        break;
      }

      case PropertyWrapper: {
        let { tags, property } = tag.value;
        let { node, reference } = property;

        if (reference.type === '_') {
          returnValue = node;
          s.node.tags = Tags.push(s.node.tags, node);
          s.node.children = s.node.tags[1][1];

          s.resultPath = TagPath.from(s.path, -1, -1);
          if (Tags.getAt(-1, s.node.tags).type === PropertyWrapper) {
            s.referenceTagPath = TagPath.from(s.path, -1, 0);
          }
          s.held = null;
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

        s.advance(tag);

        returnValue = Array.isArray(node) ? node : new NodeFacade(node);
        break;
      }

      default:
        throw new Error();
    }

    tag = yield returnValue;
  }
}
