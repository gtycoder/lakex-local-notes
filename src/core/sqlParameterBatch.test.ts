import { describe, expect, it } from "vitest";

import {
  SQL_PARAMETER_BATCH_SIZE,
  sqlParameterBatches,
} from "./sqlParameterBatch.js";

describe("sqlParameterBatches", () => {
  it("keeps empty input as zero batches", () => {
    expect(sqlParameterBatches([])).toEqual([]);
  });

  it("splits values on the configured boundary", () => {
    const total = SQL_PARAMETER_BATCH_SIZE * 2 + 3;
    const values = Array.from({ length: total }, (_, index) => index);
    const batches = sqlParameterBatches(values);

    expect(batches.map((batch) => batch.length)).toEqual([
      SQL_PARAMETER_BATCH_SIZE,
      SQL_PARAMETER_BATCH_SIZE,
      3,
    ]);
    expect(batches.flat()).toEqual(values);
  });
});
