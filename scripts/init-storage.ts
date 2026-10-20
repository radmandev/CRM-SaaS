import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../src/server/env";

// Creates the configured bucket if it does not exist (idempotent). Production buckets are normally provisioned
// by infrastructure; this is for local and CI environments.
const e = env();
const s3 = new S3Client({ region: e.S3_REGION, endpoint: e.S3_ENDPOINT, forcePathStyle: e.S3_FORCE_PATH_STYLE, credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY } });
try {
  await s3.send(new HeadBucketCommand({ Bucket: e.S3_BUCKET }));
  console.log(`Bucket ${e.S3_BUCKET} exists`);
} catch {
  await s3.send(new CreateBucketCommand({ Bucket: e.S3_BUCKET }));
  console.log(`Created bucket ${e.S3_BUCKET}`);
}
