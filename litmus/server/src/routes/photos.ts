import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../services/prisma';
import { AppError } from '../utils/AppError';
import { ok, created } from '../utils/respond';

const router = Router();

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const MAX_PHOTOS = 5;
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

// S3 client — only active when S3_BUCKET env var is set
const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.AWS_REGION ?? 'ap-south-1';
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL; // optional CDN prefix

const s3 = S3_BUCKET
  ? new S3Client({ region: S3_REGION })
  : null;

// Ensure local uploads dir exists (fallback when S3 not configured)
if (!S3_BUCKET) {
  fs.mkdir(UPLOADS_DIR, { recursive: true }).catch(() => {});
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
  },
});

async function compressImages(buffer: Buffer): Promise<{ mainBuf: Buffer; thumbBuf: Buffer }> {
  const [mainBuf, thumbBuf] = await Promise.all([
    sharp(buffer)
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer(),
    sharp(buffer)
      .resize(200, 200, { fit: 'cover' })
      .jpeg({ quality: 70 })
      .toBuffer(),
  ]);
  return { mainBuf, thumbBuf };
}

async function saveToS3(
  mainBuf: Buffer,
  thumbBuf: Buffer,
  fileId: string
): Promise<{ url: string; thumbUrl: string; s3Key: string }> {
  const mainKey = `photos/${fileId}.jpg`;
  const thumbKey = `photos/${fileId}_thumb.jpg`;

  await Promise.all([
    s3!.send(new PutObjectCommand({
      Bucket: S3_BUCKET!,
      Key: mainKey,
      Body: mainBuf,
      ContentType: 'image/jpeg',
    })),
    s3!.send(new PutObjectCommand({
      Bucket: S3_BUCKET!,
      Key: thumbKey,
      Body: thumbBuf,
      ContentType: 'image/jpeg',
    })),
  ]);

  const base = CLOUDFRONT_URL
    ? CLOUDFRONT_URL.replace(/\/$/, '')
    : `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com`;

  return {
    url: `${base}/${mainKey}`,
    thumbUrl: `${base}/${thumbKey}`,
    s3Key: mainKey,
  };
}

async function saveLocally(
  mainBuf: Buffer,
  thumbBuf: Buffer,
  fileId: string
): Promise<{ url: string; thumbUrl: string }> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(UPLOADS_DIR, `${fileId}.jpg`), mainBuf),
    fs.writeFile(path.join(UPLOADS_DIR, `${fileId}_thumb.jpg`), thumbBuf),
  ]);
  return {
    url: `/uploads/${fileId}.jpg`,
    thumbUrl: `/uploads/${fileId}_thumb.jpg`,
  };
}

// POST /api/photos/upload
router.post(
  '/upload',
  requireAuth,
  upload.single('photo'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw AppError.badRequest('No photo file provided');

      const { entry_id, session_id } = req.body as { entry_id?: string; session_id?: string };
      if (!entry_id) throw AppError.badRequest('entry_id is required');

      const existing = await prisma.pvPhoto.count({ where: { entry_id, deleted_at: null } });
      if (existing >= MAX_PHOTOS) {
        throw AppError.badRequest(`Maximum ${MAX_PHOTOS} photos per entry`);
      }

      const fileId = session_id
        ? `${session_id.slice(0, 8)}_${entry_id.slice(0, 8)}_${uuidv4()}`
        : uuidv4();

      const { mainBuf, thumbBuf } = await compressImages(req.file.buffer);

      let url: string, thumbUrl: string, s3_key: string | null = null;

      if (s3 && S3_BUCKET) {
        const result = await saveToS3(mainBuf, thumbBuf, fileId);
        url = result.url;
        thumbUrl = result.thumbUrl;
        s3_key = result.s3Key;
      } else {
        const result = await saveLocally(mainBuf, thumbBuf, fileId);
        url = result.url;
        thumbUrl = result.thumbUrl;
      }

      const photo = await prisma.pvPhoto.create({
        data: { entry_id, url, thumb_url: thumbUrl, s3_key },
      });

      created(res, photo);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/photos/:id
router.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const photo = await prisma.pvPhoto.findUnique({ where: { id: req.params.id } });
    if (!photo || photo.deleted_at) throw AppError.notFound('Photo not found');
    ok(res, photo);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/photos/:id (soft delete + S3 cleanup)
router.delete('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const photo = await prisma.pvPhoto.findUnique({ where: { id: req.params.id } });
    if (!photo || photo.deleted_at) throw AppError.notFound('Photo not found');

    // Best-effort S3 cleanup
    if (s3 && S3_BUCKET && photo.s3_key) {
      const thumbKey = photo.s3_key.replace('.jpg', '_thumb.jpg');
      await Promise.allSettled([
        s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: photo.s3_key })),
        s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: thumbKey })),
      ]);
    }

    await prisma.pvPhoto.update({ where: { id: req.params.id }, data: { deleted_at: new Date() } });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
