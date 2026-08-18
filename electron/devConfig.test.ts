import { describe, expect, it } from "vitest";
import { readDevS3Settings } from "./devConfig";

describe("readDevS3Settings", () => {
  it("does not seed S3 when either credential is missing", () => {
    expect(readDevS3Settings({ LAKE_DEV_S3_ACCESS_KEY_ID: "ak" })).toBeNull();
    expect(readDevS3Settings({ LAKE_DEV_S3_SECRET_ACCESS_KEY: "sk" })).toBeNull();
  });

  it("reads credentials from environment and applies safe non-secret defaults", () => {
    expect(readDevS3Settings({
      LAKE_DEV_S3_ACCESS_KEY_ID: " ak ",
      LAKE_DEV_S3_SECRET_ACCESS_KEY: " sk ",
    })).toEqual({
      endpoint: "https://s3.cn-north-1.qiniucs.com",
      region: "cn-north-1",
      bucket: "local-lake-hebei",
      prefix: "lake-notes",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      forcePathStyle: false,
    });
  });

  it("allows non-secret connection settings to be overridden", () => {
    expect(readDevS3Settings({
      LAKE_DEV_S3_ACCESS_KEY_ID: "ak",
      LAKE_DEV_S3_SECRET_ACCESS_KEY: "sk",
      LAKE_DEV_S3_ENDPOINT: " https://example.test ",
      LAKE_DEV_S3_REGION: " test-1 ",
      LAKE_DEV_S3_BUCKET: " bucket ",
      LAKE_DEV_S3_PREFIX: " prefix ",
    })).toMatchObject({
      endpoint: "https://example.test",
      region: "test-1",
      bucket: "bucket",
      prefix: "prefix",
    });
  });
});
