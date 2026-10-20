import { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { env } from "./env";

let client: S3Client | undefined;
function s3() {
  const e = env();
  return (client ??= new S3Client({
    region: e.S3_REGION,
    endpoint: e.S3_ENDPOINT,
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
  }));
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const cmd = new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, Body: body, ContentType: contentType });
  try {
    await s3().send(cmd);
  } catch (err) {
    // Development convenience: create the bucket on first use. Production buckets are provisioned explicitly.
    if ((err as { name?: string }).name !== "NoSuchBucket" || env().NODE_ENV === "production") throw err;
    await s3().send(new CreateBucketCommand({ Bucket: env().S3_BUCKET }));
    await s3().send(cmd);
  }
}

export async function getObject(key: string): Promise<Uint8Array> {
  const res = await s3().send(new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
  return res.Body!.transformToByteArray();
}

export async function storageReachable(): Promise<boolean> {
  try {
    await s3().send(new HeadBucketCommand({ Bucket: env().S3_BUCKET }));
    return true;
  } catch (err) {
    return (err as { name?: string }).name === "NotFound" && env().NODE_ENV !== "production"; // bucket is created lazily in dev
  }
}
