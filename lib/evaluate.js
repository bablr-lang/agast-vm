import { Coroutine } from '@bablr/coroutine';
import {
  buildNullTag,
  buildGapTag,
  buildShiftTag,
  buildReferenceTag,
  buildLiteralTag,
  buildWriteEffect,
  buildDoctypeTag,
  buildNodeOpenTag,
  buildNodeCloseTag,
} from '@bablr/agast-vm-helpers/internal-builders';
import { getEmbeddedObject, getEmbeddedTag } from '@bablr/agast-vm-helpers/deembed';
import { StreamIterable, getStreamIterator } from '@bablr/agast-helpers/stream';
import { printExpression } from '@bablr/agast-helpers/print';
import {
  getRange,
  getOpenTag,
  buildArrayInitializerTag,
  buildFragmentCloseTag,
  buildFragmentOpenTag,
} from '@bablr/agast-helpers/tree';
import {
  DoctypeTag,
  OpenNodeTag,
  CloseNodeTag,
  ReferenceTag,
  ShiftTag,
  GapTag,
  NullTag,
  ArrayInitializerTag,
  LiteralTag,
  CloseFragmentTag,
  OpenFragmentTag,
} from '@bablr/agast-helpers/symbols';
import * as btree from '@bablr/agast-helpers/btree';
import { State } from './state.js';
import { facades } from './facades.js';

export const evaluate = (ctx, strategy, options) =>
  new StreamIterable(__evaluate(ctx, strategy, options));

const __evaluate = function* agast(ctx, strategy, options = {}) {
  let s = State.from(ctx, options.expressions);

  const co = new Coroutine(getStreamIterator(strategy(facades.get(ctx), facades.get(s))));

  co.advance();

  for (;;) {
    if (co.current instanceof Promise) {
      co.current = yield co.current;
    }

    if (co.done) break;

    const instr = co.value;

    let returnValue = undefined;

    const { verb, arguments: args = [] } = instr;

    switch (verb) {
      case 'branch': {
        s = s.branch();

        returnValue = facades.get(s);
        break;
      }

      case 'accept': {
        s = s.accept();

        if (s.depth === 0) {
          yield* s.emit();
        }

        returnValue = facades.get(s);
        break;
      }

      case 'reject': {
        s = s.reject();

        returnValue = facades.get(s);
        break;
      }

      case 'advance': {
        const { 0: embeddedTags, 1: options } = args;

        const tag = getEmbeddedTag(embeddedTags);

        if (
          s.held &&
          !(tag.type === OpenNodeTag || tag.type === ReferenceTag || tag.type === GapTag)
        ) {
          throw new Error('Cannot advance while holding');
        }

        switch (tag?.type || NullTag) {
          case DoctypeTag: {
            const { attributes } = tag.value;

            if (s.path) {
              throw new Error();
            }

            returnValue = s.advance(buildDoctypeTag(attributes));
            break;
          }

          case OpenFragmentTag: {
            const { flags } = tag.value;

            returnValue = s.advance(buildFragmentOpenTag(flags), getEmbeddedObject(options));
            break;
          }

          case CloseFragmentTag: {
            returnValue = s.advance(buildFragmentCloseTag());
            break;
          }

          case LiteralTag: {
            if (!s.node.flags.token) {
              throw new Error('literals must occur inside tokens');
            }

            if (s.held) {
              throw new Error('Cannot consume input while hold register is full');
            }

            returnValue = s.advance(buildLiteralTag(tag.value));
            break;
          }

          case ReferenceTag: {
            const { name, isArray, hasGap } = tag.value;

            if (s.node?.flags.token && name !== '@') {
              throw new Error('A token node cannot contain a reference');
            }

            returnValue = s.advance(buildReferenceTag(name, isArray, { hasGap }));
            break;
          }

          case GapTag: {
            const reference = s.result.child;

            if (reference?.type !== ReferenceTag) throw new Error();

            returnValue = s.advance(buildGapTag());
            break;
          }

          case NullTag: {
            const reference = s.result.child;

            if (reference?.type !== ReferenceTag) throw new Error();

            returnValue = s.advance(buildNullTag());
            break;
          }

          case ArrayInitializerTag: {
            const reference = s.result.child;

            if (reference?.type !== ReferenceTag) throw new Error();
            if (!reference.value.isArray) throw new Error();

            returnValue = s.advance(buildArrayInitializerTag());
            break;
          }

          case ShiftTag: {
            const finishedNode = s.nodeForTag(s.result);

            if (!getOpenTag(finishedNode).value.flags.expression) {
              throw new Error();
            }

            returnValue = s.advance(buildShiftTag());
            break;
          }

          case OpenNodeTag: {
            const { flags, language, type, attributes } = tag.value;

            if (language && !language.startsWith('https://')) {
              throw new Error('Expected an absolute-language tag');
            }

            returnValue = s.advance(
              buildNodeOpenTag(flags, language, type, attributes),
              getEmbeddedObject(options),
            );
            break;
          }

          case CloseNodeTag: {
            returnValue = s.advance(buildNodeCloseTag());
            break;
          }

          default:
            throw new Error();
        }

        yield* s.emit();

        break;
      }

      case 'bindAttribute': {
        const { 0: key, 1: value } = args;

        const { unboundAttributes } = s;

        if (!unboundAttributes || !unboundAttributes.has(key)) {
          throw new Error('No unbound attribute to bind');
        }

        if (!s.node.type) {
          throw new Error('Cannot bind attribute to fragment');
        }

        if (key === 'span') throw new Error('too late');

        // if (stateIsDifferent) {
        //   // we can't allow effects to cross state branches
        //   throw new Error();
        // }

        unboundAttributes.delete(key);

        const openTag = getOpenTag(s.node);

        if (value != null) {
          const { flags, language, type } = openTag.value;
          const attributes = { ...openTag.value.attributes, [key]: value };
          const newOpenTag = buildNodeOpenTag(flags, language, type, attributes);

          s.node.attributes = attributes;

          s.node.children = btree.replaceAt(0, s.node.children, newOpenTag);
        }

        if (!unboundAttributes.size) {
          yield* s.emit();
        }

        returnValue = getRange(s.node);
        break;
      }

      case 'getState': {
        returnValue = facades.get(s);
        break;
      }

      case 'getContext': {
        returnValue = facades.get(ctx);
        break;
      }

      case 'write': {
        if (options.emitEffects) {
          yield buildWriteEffect(args[0], args[1]?.value);
        }
        break;
      }

      default: {
        throw new Error(`Unexpected call of {type: ${printExpression(verb)}}`);
      }
    }

    co.advance(returnValue);
  }

  if (s.depth > 0) {
    throw new Error('Did not unwind state stack');
  }

  if (s.path?.depth > 0) {
    throw new Error('Did not unwind path stack');
  }

  return s.result.path.node;
};
