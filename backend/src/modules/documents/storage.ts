import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../../config.js';
import { s3Client, s3PublicClient } from '../../lib/s3.js';

// REQ-DOC-001/003/004/005/008. A small interface (matching the SmsAdapter
// precedent in reminders/sms/adapter.ts) so REQ-DOC-*'s business logic
// (service.ts) can be tested against a fake implementation - the real one
// is never verified against a live S3-compatible server in this build; see
// docs/TECH_DECISIONS.md's "Session 13 update" for why (MinIO's free
// pre-built binaries were withdrawn between Session 2 and this session).

export interface HeadResult {
  exists: boolean;
  contentLength: number | null;
}

export interface DownloadedObject {
  buffer: Buffer;
  contentType: string;
}

export interface DocumentStorage {
  presignUpload(objectKey: string, contentType: string): Promise<string>;
  presignDownload(objectKey: string): Promise<string>;
  headObject(objectKey: string): Promise<HeadResult>;
  // REQ-DOC-007: the AI worker needs the actual bytes server-side (to send
  // to the vision API) - unlike every other storage operation, which only
  // ever hands the client a URL to talk to S3 directly.
  downloadObject(objectKey: string): Promise<DownloadedObject>;
}

const UPLOAD_TTL_SEC = 15 * 60; // REQ-DOC-003
const DOWNLOAD_TTL_SEC = 60 * 60; // REQ-DOC-005/008

export const s3Storage: DocumentStorage = {
  async presignUpload(objectKey, contentType) {
    const command = new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: objectKey,
      ContentType: contentType,
    });
    return getSignedUrl(s3PublicClient, command, { expiresIn: UPLOAD_TTL_SEC });
  },

  async presignDownload(objectKey) {
    const command = new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey });
    return getSignedUrl(s3PublicClient, command, { expiresIn: DOWNLOAD_TTL_SEC });
  },

  async headObject(objectKey) {
    try {
      const result = await s3Client.send(
        new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }),
      );
      return { exists: true, contentLength: result.ContentLength ?? null };
    } catch {
      // AWS SDK v3 throws on a 404 (and on any other failure) - any failure
      // here means "cannot confirm the object exists", which is the correct
      // conservative answer for REQ-DOC-004's upload-completion check.
      return { exists: false, contentLength: null };
    }
  },

  async downloadObject(objectKey) {
    const result = await s3Client.send(
      new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }),
    );
    if (!result.Body) {
      throw new Error(`Object "${objectKey}" has no body`);
    }
    // AWS SDK v3's response Body carries a `transformToByteArray()` helper
    // (the SdkStreamMixin) in the Node runtime - no manual stream-to-buffer
    // plumbing needed.
    const bytes = await result.Body.transformToByteArray();
    return {
      buffer: Buffer.from(bytes),
      contentType: result.ContentType ?? 'application/octet-stream',
    };
  },
};

// REQ-DOC-002: object key is entirely server-generated, always `.jpg`
// (Question 3, docs/OPEN_QUESTIONS.md - only image/jpeg is accepted).
export function buildObjectKey(patientId: string, documentId: string): string {
  return `patients/${patientId}/${documentId}.jpg`;
}
