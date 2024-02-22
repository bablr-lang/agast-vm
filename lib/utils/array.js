export const findRight = (arr, predicate) => {
  for (let i = arr.length - 1; i >= 0; i--) {
    const value = arr[i];
    if (predicate(value)) return value;
  }
  return null;
};
