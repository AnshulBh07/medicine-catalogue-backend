import crypto from 'node:crypto';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from '../../common/errors/app-error.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

const MIME_TO_EXTENSION: Record<AllowedImageMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const MAX_IMAGE_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const PRESIGNED_URL_EXPIRATION_SECONDS = 300; // 5 minutes

export interface R2StorageConfig {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucketName?: string;
  endpoint?: string;
  publicUrl?: string;
}

export interface PresignedUploadRequest {
  contentType: string;
  fileSize?: number;
  fileName?: string;
}

export interface PresignedUploadResponse {
  uploadUrl: string;
  objectKey: string;
  publicUrl: string;
}

export class R2StorageService {
  private client: S3Client | null = null;
  private configOverride?: R2StorageConfig;

  constructor(configOverride?: R2StorageConfig, customClient?: S3Client) {
    this.configOverride = configOverride;
    if (customClient) {
      this.client = customClient;
    }
  }

  private getConfig(): R2StorageConfig {
    return {
      accountId: this.configOverride?.accountId ?? env.R2_ACCOUNT_ID,
      accessKeyId: this.configOverride?.accessKeyId ?? env.R2_ACCESS_KEY_ID,
      secretAccessKey: this.configOverride?.secretAccessKey ?? env.R2_SECRET_ACCESS_KEY,
      bucketName: this.configOverride?.bucketName ?? env.R2_BUCKET_NAME,
      endpoint: this.configOverride?.endpoint ?? env.R2_ENDPOINT,
      publicUrl: this.configOverride?.publicUrl ?? env.R2_PUBLIC_URL,
    };
  }

  public validateConfig(): void {
    const config = this.getConfig();

    const missingFields: string[] = [];
    if (!config.accessKeyId) missingFields.push('R2_ACCESS_KEY_ID');
    if (!config.secretAccessKey) missingFields.push('R2_SECRET_ACCESS_KEY');
    if (!config.bucketName) missingFields.push('R2_BUCKET_NAME');
    if (!config.publicUrl) missingFields.push('R2_PUBLIC_URL');
    if (!config.endpoint && !config.accountId) missingFields.push('R2_ENDPOINT or R2_ACCOUNT_ID');

    if (missingFields.length > 0) {
      throw new AppError(
        500,
        'STORAGE_CONFIG_ERROR',
        `Cloudflare R2 storage is not properly configured. Missing: ${missingFields.join(', ')}`,
      );
    }
  }

  public getS3Client(): S3Client {
    if (this.client) {
      return this.client;
    }

    this.validateConfig();
    const config = this.getConfig();

    const endpoint =
      config.endpoint ||
      (config.accountId
        ? `https://${config.accountId}.r2.cloudflarestorage.com`
        : undefined);

    const s3Config: S3ClientConfig = {
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId: config.accessKeyId!,
        secretAccessKey: config.secretAccessKey!,
      },
    };

    this.client = new S3Client(s3Config);
    return this.client;
  }

  public generateObjectKey(contentType: AllowedImageMimeType): string {
    const extension = MIME_TO_EXTENSION[contentType] || 'jpg';
    const medicineUuid = crypto.randomUUID();
    const fileUuid = crypto.randomUUID();
    return `medicines/${medicineUuid}/packaging-${fileUuid}.${extension}`;
  }

  public generateProfileImageObjectKey(userId: string, contentType: AllowedImageMimeType): string {
    const extension = MIME_TO_EXTENSION[contentType] || 'jpg';
    const fileUuid = crypto.randomUUID();
    const cleanUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    return `profile-images/${cleanUserId}/avatar-${fileUuid}.${extension}`;
  }

  public getObjectKeyFromUrl(url: string | null | undefined): string | null {
    if (!url || typeof url !== 'string') return null;

    const trimmed = url.trim();
    if (!trimmed) return null;

    const config = this.getConfig();
    const publicUrlBase = config.publicUrl?.trim()?.replace(/\/+$/, '');

    if (publicUrlBase && trimmed.startsWith(publicUrlBase)) {
      const remainder = trimmed.slice(publicUrlBase.length).replace(/^\/+/, '');
      if (remainder) {
        return remainder;
      }
    }

    try {
      const parsed = new URL(trimmed);
      const pathname = parsed.pathname.replace(/^\/+/, '');
      if (pathname.startsWith('medicines/') || pathname.startsWith('profile-images/')) {
        return pathname;
      }
    } catch {
      if (trimmed.startsWith('medicines/') || trimmed.startsWith('profile-images/')) {
        return trimmed;
      }
    }

    return null;
  }

  public buildPublicUrl(objectKey: string): string {
    const config = this.getConfig();
    if (!config.publicUrl) {
      throw new AppError(
        500,
        'STORAGE_CONFIG_ERROR',
        'R2_PUBLIC_URL environment variable is required to generate public image URLs',
      );
    }
    const cleanBase = config.publicUrl.trim().replace(/\/+$/, '');
    const cleanKey = objectKey.replace(/^\/+/, '');
    return `${cleanBase}/${cleanKey}`;
  }

  public async createPresignedUploadUrl(
    input: PresignedUploadRequest,
  ): Promise<PresignedUploadResponse> {
    const normalizedMime = input.contentType?.toLowerCase()?.trim() as AllowedImageMimeType;

    if (!ALLOWED_IMAGE_MIME_TYPES.includes(normalizedMime)) {
      throw new AppError(
        400,
        'INVALID_CONTENT_TYPE',
        `Unsupported image type '${input.contentType}'. Allowed types: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}`,
      );
    }

    if (input.fileSize !== undefined && input.fileSize > MAX_IMAGE_FILE_SIZE_BYTES) {
      throw new AppError(
        400,
        'FILE_TOO_LARGE',
        `Image size exceeds the maximum allowed limit of ${MAX_IMAGE_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
      );
    }

    this.validateConfig();
    const config = this.getConfig();
    const objectKey = this.generateObjectKey(normalizedMime);
    const publicUrl = this.buildPublicUrl(objectKey);

    const s3Client = this.getS3Client();

    const command = new PutObjectCommand({
      Bucket: config.bucketName,
      Key: objectKey,
      ContentType: normalizedMime === 'image/jpg' ? 'image/jpeg' : normalizedMime,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: PRESIGNED_URL_EXPIRATION_SECONDS,
    });

    return {
      uploadUrl,
      objectKey,
      publicUrl,
    };
  }

  public async createPresignedProfileImageUploadUrl(
    userId: string,
    input: PresignedUploadRequest,
  ): Promise<PresignedUploadResponse> {
    const normalizedMime = input.contentType?.toLowerCase()?.trim() as AllowedImageMimeType;

    if (!ALLOWED_IMAGE_MIME_TYPES.includes(normalizedMime)) {
      throw new AppError(
        400,
        'INVALID_CONTENT_TYPE',
        `Unsupported image type '${input.contentType}'. Allowed types: ${ALLOWED_IMAGE_MIME_TYPES.join(', ')}`,
      );
    }

    if (input.fileSize !== undefined && input.fileSize > MAX_IMAGE_FILE_SIZE_BYTES) {
      throw new AppError(
        400,
        'FILE_TOO_LARGE',
        `Image size exceeds the maximum allowed limit of ${MAX_IMAGE_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
      );
    }

    this.validateConfig();
    const config = this.getConfig();
    const objectKey = this.generateProfileImageObjectKey(userId, normalizedMime);
    const publicUrl = this.buildPublicUrl(objectKey);

    const s3Client = this.getS3Client();

    const command = new PutObjectCommand({
      Bucket: config.bucketName,
      Key: objectKey,
      ContentType: normalizedMime === 'image/jpg' ? 'image/jpeg' : normalizedMime,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: PRESIGNED_URL_EXPIRATION_SECONDS,
    });

    return {
      uploadUrl,
      objectKey,
      publicUrl,
    };
  }

  public async deleteObject(objectKey: string): Promise<void> {
    if (!objectKey || typeof objectKey !== 'string') return;

    try {
      this.validateConfig();
      const config = this.getConfig();
      const s3Client = this.getS3Client();

      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: config.bucketName,
          Key: objectKey,
        }),
      );
    } catch (err) {
      // Safe server-side warning without logging secrets
      logger.warn(
        { objectKey, err: err instanceof Error ? err.message : 'Unknown storage deletion error' },
        'Failed to delete object from Cloudflare R2 storage',
      );
    }
  }

  public async deleteObjectByPublicUrl(publicUrl: string | null | undefined): Promise<void> {
    if (!publicUrl) return;
    const objectKey = this.getObjectKeyFromUrl(publicUrl);
    if (objectKey) {
      await this.deleteObject(objectKey);
    }
  }
}

export const r2StorageService = new R2StorageService();
