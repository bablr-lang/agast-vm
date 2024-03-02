/* global console */

import { expect } from 'expect';
import { evaluateSync, Context } from '@bablr/agast-vm';
import { createPassthroughStrategy } from '@bablr/agast-vm-strategy-passthrough';
import { enhanceStrategyWithDebugLogging } from '@bablr/strategy_enhancer-debug-log';

import * as builders from '@bablr/agast-helpers/builders';
import * as sourceBuilders from '@bablr/agast-vm-helpers/builders';

export const runTest = (testCase) => {
  console.log();
  const resultTokens = [
    ...evaluateSync(
      Context.create(),
      enhanceStrategyWithDebugLogging(createPassthroughStrategy(testCase.tokens(sourceBuilders))),
    ),
  ];

  expect(resultTokens).toEqual(testCase.tokens(builders));
};

runTest({
  tokens: (b) => [b.buildFragmentOpenTag(), b.buildFragmentCloseTag()],
});

runTest({
  tokens: (b) => [
    b.buildFragmentOpenTag(),
    b.buildReference('node', false),
    b.buildNodeOpenTag({}, 'Node'),
    b.buildLiteral('hello world'),
    b.buildNodeCloseTag('Node'),
    b.buildFragmentCloseTag(),
  ],
});

runTest({
  tokens: (b) => [
    b.buildFragmentOpenTag(),
    b.buildFragmentOpenTag({ trivia: true }),
    b.buildReference('children', true),
    b.buildNodeOpenTag({}, 'Blank'),
    b.buildLiteral(' '),
    b.buildNodeCloseTag(),
    b.buildFragmentCloseTag(),
    b.buildFragmentCloseTag(),
  ],
});

runTest({
  tokens: (b) => [
    b.buildFragmentOpenTag(),
    b.buildNodeOpenTag({ trivia: true }, 'Blank'),
    b.buildLiteral(' '),
    b.buildNodeCloseTag(),
    b.buildFragmentCloseTag(),
  ],
});

runTest({
  tokens: (b) => [
    b.buildNodeOpenTag({ trivia: true }, 'Blank'),
    b.buildLiteral(' '),
    b.buildNodeCloseTag(),
  ],
});

runTest({
  tokens: (b) => [
    b.buildFragmentOpenTag(),
    b.buildReference('root', false),
    b.buildNodeOpenTag({ intrinsic: true }, 'Keyword'),
    b.buildLiteral('true'),
    b.buildNodeCloseTag(),
    b.buildFragmentCloseTag(),
  ],
});

expect(() => {
  runTest({
    tokens: (b) => [
      b.buildFragmentOpenTag(),
      b.buildNodeOpenTag({}, 'Node'),
      b.buildNodeCloseTag('Node'),
      b.buildFragmentCloseTag(),
    ],
  });
}).toThrow();

expect(() => {
  runTest({
    tokens: (b) => [b.buildFragmentOpenTag({ trivia: true }), b.buildFragmentCloseTag()],
  });
}).toThrow();

expect(() => {
  runTest({
    tokens: (b) => [
      b.buildFragmentOpenTag(),
      b.buildFragmentOpenTag(),
      b.buildFragmentCloseTag(),
      b.buildFragmentCloseTag(),
    ],
  });
}).toThrow();

expect(() => {
  runTest({
    tokens: (b) => [
      b.buildFragmentOpenTag(),
      // not matching anything: should fail?
      b.buildFragmentOpenTag({ trivia: true }),
      b.buildFragmentCloseTag(),
      b.buildFragmentCloseTag(),
    ],
  });
}).toThrow();

expect(() => {
  runTest({
    tokens: (b) => [
      b.buildFragmentOpenTag(),
      b.buildReference('root', false),
      b.buildNodeOpenTag({ intrinsic: true }, 'Node'),
      b.buildNodeCloseTag(),
      b.buildFragmentCloseTag(),
    ],
  });
}).toThrow();

expect(() => {
  runTest({
    tokens: (b) => [
      b.buildFragmentOpenTag(),
      b.buildReference('root', false),
      b.buildNodeOpenTag({ intrinsic: true }, 'Node'),
      b.buildLiteral('='),
      b.buildLiteral('>'),
      b.buildNodeCloseTag(),
      b.buildFragmentCloseTag(),
    ],
  });
}).toThrow();
