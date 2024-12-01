export function first(iter) {
  for (const value of iter) {
    return value;
  }
}

export function* drop(n, iterable) {
  let i = -1;
  for (const value of iterable) {
    ++i;
    if (i >= n) yield value;
  }
}
