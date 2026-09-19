import { S3Client } from '@aws-sdk/client-s3';
import { config } from '../config.js';

// REQ-DOC-003, docs/TECH_DECISIONS.md's "Object storage" entry. Two clients,
// same bucket/credentials, different endpoint hosts: the server itself
// reaches `S3_ENDPOINT` directly (HeadObject, in storage.ts), but a
// presigned URL handed to a phone must point at `S3_PUBLIC_ENDPOINT` - the
// host phones can actually reach (backend.md §5's "presigned URL gotcha";
// localhost never works for a real device). `forcePathStyle: true` is the
// documented fix for the AWS-SDK-v3-vs-MinIO `SignatureDoesNotMatch` gotcha
// also flagged in that same tech-decisions entry.
const credentials = {
  accessKeyId: config.S3_ACCESS_KEY,
  secretAccessKey: config.S3_SECRET_KEY,
};

export const s3Client = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials,
});

export const s3PublicClient = new S3Client({
  endpoint: config.S3_PUBLIC_ENDPOINT,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials,
});
