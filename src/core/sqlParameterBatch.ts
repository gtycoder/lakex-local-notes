/** Conservative SQLite bound-parameter batch size. */
export const SQL_PARAMETER_BATCH_SIZE = 500;

/**
 * Splits values into batches that are safe for dynamic `IN (...)` clauses.
 * SQLite builds commonly allow 999 or 32766 parameters; 500 leaves room for
 * leading parameters while keeping generated statements small.
 */
export function sqlParameterBatches<T>(values: readonly T[]): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += SQL_PARAMETER_BATCH_SIZE) {
    batches.push(values.slice(index, index + SQL_PARAMETER_BATCH_SIZE));
  }
  return batches;
}
