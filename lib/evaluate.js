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
} from '@bablr/agast-helpers/builders';
import { StreamIterable, getStreamIterator } from '@bablr/agast-helpers/stream';
import { printExpression } from '@bablr/agast-helpers/print';
import { reifyExpression } from '@bablr/agast-vm-helpers';
import { Path } from './path.js';
import { Node } from './node.js';
import { State } from './state.js';
import { facades } from './facades.js';

export const evaluate = (ctx, strategy, options) =>
  new StreamIterable(__evaluate(ctx, strategy, options));

const __evaluate = function* agast(ctx, strategy, options = {}) {
  let s = State.from(ctx);

  const co = new Coroutine(getStreamIterator(strategy(facades.get(ctx), facades.get(s))));

  co.advance();

  for (;;) {
    if (co.current instanceof Promise) {
      co.current = yield co.current;
    }

    if (co.done) break;

    const sourceInstr = co.value;
    const instr = reifyExpression(sourceInstr);
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
        const { 0: terminal, 1: options } = args;

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
            const doctypeTag = buildDoctypeTag(attributes);
            const rootPath = Path.from(ctx, doctypeTag);

            if (s.path) {
              throw new Error();
            }

            s.path = rootPath;

            yield* s.emit(doctypeTag);

            returnValue = doctypeTag;
            break;
          }

          case 'Literal': {
            const literal = buildLiteral(terminal.value);

            if (!s.node.flags.token) {
              throw new Error('literals must occur inside tokens');
            }

            if (s.held) {
              throw new Error('Cannot consume input while hold register is full');
            }

            yield* s.emit(literal);

            returnValue = literal;
            break;
          }

          case 'Reference': {
            const { name, isArray } = terminal.value;

            const tag = buildReference(name, isArray);

            if (s.result.type === 'Reference') {
              throw new Error('A reference must have a non-reference value');
            }

            if (s.node?.flags.token) {
              throw new Error();
            }

            if (s.path.depth) {
              s.node.resolver.consume(tag);
            }

            s.path = s.path.push(ctx, tag);
            s.node = null;

            ctx.tagPaths.set(tag, s.path);

            yield* s.emit(tag);

            returnValue = tag;
            break;
          }

          case 'Gap': {
            const reference = s.result;

            if (reference?.type !== 'Reference') throw new Error();

            const gapTag = buildGap();

            s.held = null;

            ctx.tagPaths.set(gapTag, s.path);

            s.node = s.parentNode;
            s.path = s.path.parent;

            yield* s.emit(gapTag);

            returnValue = gapTag;
            break;
          }

          case 'Null': {
            const reference = s.result;

            if (reference?.type !== 'Reference') throw new Error();

            const null_ = buildNull();

            ctx.tagPaths.set(null_, s.path);

            s.node = s.parentNode;
            s.path = s.path.parent;

            yield* s.emit(null_);

            returnValue = null_;
            break;
          }

          case 'Shift': {
            const tag = buildShift();

            const finishedNode = ctx.nodeForTag(s.result);
            const ref = ctx.getPreviousTerminal(finishedNode.openTag);
            const finishedPath = ctx.pathForTag(ref);

            ctx.pathNodes.set(finishedPath, null);

            s.held = { node: finishedNode, path: finishedPath };

            if (!finishedNode.openTag.value.flags.expression) {
              throw new Error();
            }

            s.path = finishedPath;

            yield* s.emit(tag);

            returnValue = tag;
            break;
          }

          case 'OpenNodeTag': {
            const { flags, language, type, intrinsicValue, attributes } = terminal.value;
            const { unboundAttributes } = options || {};
            const reference = s.result;
            const openTag = buildNodeOpenTag(flags, language, type, intrinsicValue, attributes);

            if (!type) {
              s.node = Node.from(openTag);
              ctx.pathNodes.set(s.path, s.node);
              ctx.pathNodes.set(s.node, s.path);
              ctx.tagNodes.set(openTag, s.node);
              ctx.tagPaths.set(openTag, s.path);
            } else {
              if (!flags.trivia && !flags.escape) {
                if (
                  reference.type !== 'Reference' &&
                  reference.type !== 'Shift' &&
                  reference.type !== 'OpenFragmentTag'
                ) {
                  throw new Error('Invalid location for OpenNodeTag');
                }
              }

              const newNode = new Node(openTag);

              newNode.unboundAttributes = new Set(unboundAttributes);

              s.node = newNode;
              if (flags.trivia || flags.escape) {
                s.path = s.path.push(ctx, null);
              }

              ctx.pathNodes.set(newNode, s.path);
              ctx.pathNodes.set(s.path, newNode);
              ctx.tagNodes.set(openTag, newNode);
              ctx.tagPaths.set(openTag, s.path);

              if (intrinsicValue) {
                newNode.closeTag = newNode.openTag;
                s.node = s.parentNode;
                s.path = s.path.parent;

                const { properties } = s.node;
                const { name: refName, isArray } = reference.value;

                if (!isArray) {
                  properties.set(refName, [openTag, openTag]);
                } else {
                  if (!properties.has(refName)) {
                    properties.set(refName, []);
                  }
                  properties.get(refName).push([openTag, openTag]);
                }
              }
            }

            yield* s.emit(openTag);

            returnValue = openTag;
            break;
          }

          case 'CloseNodeTag': {
            const { type, language } = terminal.value;
            const { openTag } = s.node;
            const { flags, type: openType } = openTag.value;

            const closeTag = buildNodeCloseTag(type, language);

            if (openType) {
              if (s.node.unboundAttributes?.size)
                throw new Error('Grammar failed to bind all attributes');

              if (!type) throw new Error(`CloseNodeTag must have type`);

              if (type !== openType)
                throw new Error(
                  `Grammar close {type: ${type}} did not match open {type: ${openType}}`,
                );

              if (!flags.escape && !flags.trivia) {
                const { name: refName, isArray } = s.path.reference.value;

                const { properties } = ctx.nodeForPath(s.path.parent);

                if (!isArray) {
                  properties.set(refName, [openTag, closeTag]);
                } else {
                  if (!properties.has(refName)) {
                    properties.set(refName, []);
                  }
                  properties.get(refName).push([openTag, closeTag]);
                }
              }

              ctx.tagNodes.set(closeTag, s.node);
              ctx.tagPaths.set(closeTag, s.path);

              s.node.closeTag = closeTag;

              s.node = s.parentNode;

              s.path = s.path.parent;
            }

            yield* s.emit(closeTag, flags.expression);

            returnValue = closeTag;
            break;
          }

          default:
            throw new Error();
        }

        break;
      }

      case 'bindAttribute': {
        const { 0: key, 1: value } = args;

        const { unboundAttributes } = s.node;

        if (!unboundAttributes || !unboundAttributes.has(key)) {
          throw new Error('No unbound attribute to bind');
        }

        if (!s.node.openTag.value.type) {
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

        const { openTag } = s.node;

        if (value != null) {
          const { flags, language, type, intrinsicValue } = openTag.value;
          const attributes = { ...openTag.value.attributes, [key]: value };
          const newOpenTag = buildNodeOpenTag(flags, language, type, intrinsicValue, attributes);

          let openNext = ctx.nextTerminals.get(openTag);
          let startPrev = ctx.prevTerminals.get(openTag);

          ctx.prevTerminals.set(newOpenTag, startPrev);
          ctx.nextTerminals.set(startPrev, newOpenTag);

          ctx.tagNodes.set(newOpenTag, ctx.tagNodes.get(openTag));

          if (openNext) {
            ctx.nextTerminals.set(newOpenTag, openNext);
            ctx.prevTerminals.set(openNext, newOpenTag);
          } else {
            // could this terminal be stored anywhere else?
            s.result = newOpenTag;
          }

          s.node.openTag = newOpenTag;
        }

        if (!unboundAttributes.size) {
          yield* s.emit();
        }

        returnValue = s.node.openTag;
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

  s.path = s.path.parent;

  if (s.depth > 0) {
    throw new Error('Did not unwind state stack');
  }

  if (s.path?.depth > 0) {
    throw new Error('Did not unwind path stack');
  }
};
