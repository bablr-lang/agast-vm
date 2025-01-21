import { Coroutine } from '@bablr/coroutine';
import {
  buildNullTag,
  buildGapTag,
  buildShiftTag,
  buildReferenceTag,
  buildLiteralTag,
  buildDoctypeTag,
  buildOpenNodeTag,
  buildCloseNodeTag,
} from '@bablr/agast-vm-helpers/internal-builders';
import { getEmbeddedTag } from '@bablr/agast-vm-helpers/deembed';
import { StreamIterable, getStreamIterator } from '@bablr/agast-helpers/stream';
import { printExpression } from '@bablr/agast-helpers/print';
import {
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
import { State } from './state.js';
import { Context } from './context.js';
import { facades } from './facades.js';

export const agast = (strategy, options = {}) => {
  const ctx = Context.create();
  let s = State.from(ctx, options.expressions);

  return new StreamIterable(__agast(ctx, s, strategy(facades.get(ctx), facades.get(s))));
};

function* __agast(ctx, s, instructions) {
  const co = new Coroutine(getStreamIterator(instructions));

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

            if (s.path.depth !== 0) {
              throw new Error();
            }

            returnValue = s.advance(buildDoctypeTag(attributes));
            break;
          }

          case OpenFragmentTag: {
            const { flags } = tag.value;

            returnValue = s.advance(buildFragmentOpenTag(flags));
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
            const { name, isArray, flags } = tag.value;

            if (s.node?.flags.token && name !== '@') {
              throw new Error('A token node cannot contain a reference');
            }

            returnValue = s.advance(buildReferenceTag(name, isArray, flags));
            break;
          }

          case GapTag: {
            returnValue = s.advance(buildGapTag());
            break;
          }

          case NullTag: {
            returnValue = s.advance(buildNullTag());
            break;
          }

          case ArrayInitializerTag: {
            const { reference } = s;

            if (reference?.type !== ReferenceTag) throw new Error();
            if (!reference.value.isArray) throw new Error();

            returnValue = s.advance(buildArrayInitializerTag());
            break;
          }

          case ShiftTag: {
            if (s.resultPath.tag.type !== GapTag) throw new Error();

            const refPath = s.resultPath.previousSibling;

            if (!refPath.tag.value.flags.expression) {
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

            returnValue = s.advance(buildOpenNodeTag(flags, language, type, attributes));
            break;
          }

          case CloseNodeTag: {
            returnValue = s.advance(buildCloseNodeTag());
            break;
          }

          default:
            throw new Error();
        }

        yield returnValue;

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

  if (s.path) {
    throw new Error('Did not unwind path stack');
  }

  return s.resultPath.path.node;
}
