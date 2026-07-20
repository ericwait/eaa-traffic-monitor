// Pure list-order math for the channel manager's drag/keyboard reorder. Kept
// free of DOM and store imports so vitest exercises the exact move semantics
// the drag preview and the ArrowUp/ArrowDown path both rely on.

/**
 * Move `id` to `index` in `order`, clamping the index to the list. Returns a
 * new array; if `id` is not in `order` the result is an unchanged copy.
 */
export function moveTo(order: readonly string[], id: string, index: number): string[] {
  const rest = order.filter((x) => x !== id)
  if (rest.length === order.length) return [...order]
  const clamped = Math.max(0, Math.min(index, rest.length))
  return [...rest.slice(0, clamped), id, ...rest.slice(clamped)]
}
