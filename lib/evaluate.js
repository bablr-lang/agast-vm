import { Coroutine } from '@bablr/coroutine';
import {
  buildReference,
  buildLiteral,
  buildNodeOpenTag,
  buildFragmentOpenTag,
  buildFragmentCloseTag,
  buildNodeCloseTag,
} from '@bablr/agast-helpers/builders';
import { printExpression } from '@bablr/agast-helpers/print';
import { reifyExpression, buildNull, runSync, runAsync } from '@bablr/agast-vm-helpers';
import { Path } from './path.js';
import { State } from './state.js';
import { actuals, facades } from './facades.js';

export function evaluate(ctxFacade, strategy) {
  const ctx = actuals.get(ctxFacade);

  if (ctxFacade && !ctx) throw new Error();

  return __evaluate(ctx, strategy);
}

function* __evaluate(ctx, strategy) {
  let s = State.from(ctx);

  const co = new Coroutine(strategy);

  co.advance();

  while (!co.done) {
    const instr = co.value;
    let returnValue = undefined;

    const { verb: verbToken } = instr.properties;
    const verb = reifyExpression(verbToken);

    switch (verb) {
      case 'branch': {
        const { context, path, result, emitted } = s;

        s = s.push(new State(context, path.branch(), result, emitted));

        returnValue = facades.get(s);
        break;
      }

      case 'accept': {
        const accepted = s;

        s = s.parent;

        if (!s) {
          throw new Error('accepted the root state');
        }

        s.path.accept(accepted.path);

        // emitted isn't used here and probably doesn't need to be part of state

        if (s.depth === 0) {
          yield* s.emit();
        }

        s.result = accepted.result;

        returnValue = facades.get(s);
        break;
      }

      case 'reject': {
        const rejectedState = s;

        ctx.nextTerminals.delete(s.result);

        s = s.parent;

        if (!s) throw new Error('rejected root state');

        if (rejectedState.path.depth > s.path.depth) {
          const lowPath = rejectedState.path.at(
            Math.min(s.path.depth + 1, rejectedState.path.depth),
          );

          const { pathName, pathIsArray } = lowPath?.reference?.value || {};

          if (!s.path.resolver.counters.has(pathName)) {
            yield* s.emit(buildReference(pathName, pathIsArray));
          }

          if (s.result.type === 'Reference') {
            yield* s.emit(buildNull());
          }
        }

        returnValue = facades.get(s);
        break;
      }

      case 'advance': {
        const {
          arguments: {
            properties: { values: { 0: terminal_ } = [] },
          },
        } = instr.properties;

        const terminal = reifyExpression(terminal_);

        switch (terminal.type) {
          case 'Literal': {
            const terminal = buildLiteral(terminal.value);

            yield* s.emit(terminal);

            break;
          }

          case 'Reference': {
            const { pathName, pathIsArray } = terminal.value;

            const tag = buildReference(pathName, pathIsArray);

            s.path.resolver.consume(tag);

            s.path = s.path.pushTag(tag);

            yield* s.emit(tag);

            returnValue = tag;
            break;
          }

          case 'Gap': {
            if (!s.path.range[0] || s.path.range[1]) {
              throw new Error();
            }

            const nullTerminal = buildNull();

            yield* s.emit(nullTerminal);

            returnValue = nullTerminal;
            break;
          }

          case 'StartNodeTag': {
            const { flags, type, attributes } = terminal.value;
            const reference = s.result;
            const isFragment = type != null;
            const openTag = isFragment
              ? buildFragmentOpenTag(flags)
              : buildNodeOpenTag(flags, type, attributes);

            if (!isFragment && reference?.type !== 'Reference') throw new Error();

            if (isFragment) {
              s.path = new Path(ctx, reference);
            }

            s.path.pushTag(openTag);

            ctx.tagPaths.set(openTag, s.path);

            yield* s.emit(openTag);

            returnValue = openTag;
            break;
          }

          case 'EndNodeTag': {
            const { type } = terminal.value;
            const isFragment = type == null;

            const startType = s.path.type;

            if (type !== startType) throw new Error();

            const endTag = isFragment ? buildFragmentCloseTag() : buildNodeCloseTag(type);

            s.path = s.path.pushTag(endTag);

            yield* s.emit(endTag);

            returnValue = endTag;
            break;
          }

          default:
            throw new Error();
        }
        break;
      }

      case 'bindAttribute': {
        const {
          arguments: {
            properties: { values: { 0: key, 1: value } = [] },
          },
        } = instr.properties;

        const { unboundAttributes } = s.path;

        const key_ = reifyExpression(key);

        if (!unboundAttributes.has(key_)) {
          throw new Error('No unbound attribute to bind');
        }

        if (s.path.startTag.type === 'OpenFragmentTag') {
          throw new Error();
        }

        if (key_ === 'span') throw new Error('too late');

        if (key_ === 'lexicalSpan') {
          // I don't think lexical spans are currently applied correctly at all
        }

        // if (stateIsDifferent) {
        //   // we can't allow effects to cross state branches
        //   throw new Error();
        // }

        unboundAttributes.delete(key_);

        const value_ = reifyExpression(value);
        const { startTag } = s.path;

        if (value_ != null) {
          const attributes = { ...startTag.value.attributes, [key_]: value_ };
          const newStartTag = buildNodeOpenTag(startTag.value.type, attributes);

          let startNext = ctx.nextTerminals.get(startTag);
          let startPrev = ctx.prevTerminals.get(startTag);

          ctx.prevTerminals.set(newStartTag, startPrev);
          ctx.nextTerminals.set(startPrev, newStartTag);

          ctx.tagPaths.set(newStartTag, s.path);

          if (startNext) {
            ctx.nextTerminals.set(newStartTag, startNext);
            ctx.prevTerminals.set(startNext, newStartTag);
          } else {
            // could this terminal might be stored anywhere else?
            s.result = newStartTag;
          }

          s.path.range[0] = newStartTag;
        }

        // m.range isn't updated yet

        if (!unboundAttributes.size) {
          yield* s.emit();
        }

        returnValue = s.path.range[0];
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

      default: {
        throw new Error(`Unexpected call of {type: ${printExpression(verb)}}`);
      }
    }

    co.advance(returnValue);
  }
}

export const evaluateSync = (...args) => runSync(evaluate(...args));
export const evaluateAsync = (...args) => runAsync(evaluate(...args));
