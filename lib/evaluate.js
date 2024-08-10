import { Coroutine } from '@bablr/coroutine';
import {
  buildNull,
  buildGap,
  buildShift,
  buildReference,
  buildLiteral,
  buildWriteEffect,
  buildDoctypeTag,
  buildNodeOpenTag,
  buildNodeCloseTag,
} from '@bablr/agast-vm-helpers/internal-builders';
import { deembedExpression } from '@bablr/agast-vm-helpers/deembed';
import { StreamIterable, getStreamIterator } from '@bablr/agast-helpers/stream';
import { printExpression } from '@bablr/agast-helpers/print';
import { getRange, getOpenTag } from '@bablr/agast-helpers/tree';
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
        const { 0: embeddedTerminal, 1: options } = args;

        const terminal = embeddedTerminal.value;

        if (
          s.held &&
          !(
            terminal.type === 'OpenNodeTag' ||
            terminal.type === 'Reference' ||
            terminal.type === 'Gap'
          )
        ) {
          throw new Error('Cannot advance while holding');
        }

        switch (terminal?.type || 'Null') {
          case 'DoctypeTag': {
            const { attributes } = terminal.value;

            if (s.path) {
              throw new Error();
            }

            returnValue = s.advance(buildDoctypeTag(attributes));
            break;
          }

          case 'Literal': {
            if (!s.node.flags.token) {
              throw new Error('literals must occur inside tokens');
            }

            if (s.held) {
              throw new Error('Cannot consume input while hold register is full');
            }

            returnValue = s.advance(buildLiteral(terminal.value));
            break;
          }

          case 'Reference': {
            const { name, isArray } = terminal.value;

            if (s.result.type === 'Reference') {
              throw new Error('A reference must have a non-reference value');
            }

            if (s.node?.flags.token) {
              throw new Error('A token node cannot contain a reference');
            }

            returnValue = s.advance(buildReference(name, isArray));
            break;
          }

          case 'Gap': {
            const reference = s.result;

            if (reference?.type !== 'Reference') throw new Error();

            returnValue = s.advance(buildGap());
            break;
          }

          case 'Null': {
            const reference = s.result;

            if (reference?.type !== 'Reference') throw new Error();

            returnValue = s.advance(buildNull());
            break;
          }

          case 'Shift': {
            const finishedNode = s.nodeForTag(s.result);

            if (!getOpenTag(finishedNode).value.flags.expression) {
              throw new Error();
            }

            returnValue = s.advance(buildShift());
            break;
          }

          case 'OpenNodeTag': {
            const { flags, language, type, attributes } = terminal.value;

            if (language && !language.startsWith('https://')) {
              throw new Error('Expected an absolute-language tag');
            }

            returnValue = s.advance(
              buildNodeOpenTag(flags, language, type, attributes),
              deembedExpression(options),
            );
            break;
          }

          case 'CloseNodeTag': {
            const { type, language } = terminal.value;

            returnValue = s.advance(buildNodeCloseTag(type, language));
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

        if (key === 'balancedSpan') {
          throw new Error('not implemented');
        }

        // if (stateIsDifferent) {
        //   // we can't allow effects to cross state branches
        //   throw new Error();
        // }

        unboundAttributes.delete(key);

        const openTag = s.node.children[0];

        if (value != null) {
          const { flags, language, type } = openTag.value;
          const attributes = { ...openTag.value.attributes, [key]: value };
          const newOpenTag = buildNodeOpenTag(flags, language, type, attributes);

          let openNext = ctx.nextTerminals.get(openTag);
          let startPrev = ctx.prevTerminals.get(openTag);

          ctx.prevTerminals.set(newOpenTag, startPrev);
          ctx.nextTerminals.set(startPrev, newOpenTag);

          if (s.node !== s.tagNodes.get(openTag)) throw new Error();
          if (s.path !== s.tagPaths.get(openTag)) throw new Error();

          s.node.attributes = attributes;

          s.tagNodes.set(newOpenTag, s.node);
          s.tagPaths.set(newOpenTag, s.path);

          if (openNext) {
            ctx.nextTerminals.set(newOpenTag, openNext);
            ctx.prevTerminals.set(openNext, newOpenTag);
          } else {
            // could this terminal be stored anywhere else?
            s.result = newOpenTag;
          }

          s.node.children[0] = newOpenTag;
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
          yield buildWriteEffect(args[0], args[1]);
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

  return s.nodeForTag(s.result);
};
