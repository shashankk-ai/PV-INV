import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../services/prisma';
import { AppError } from '../utils/AppError';
import { ok, created } from '../utils/respond';

const router = Router();

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const MAX_PHOTOS = 5;
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

// Ensure uploads dir exists
fs.mkdir(UPLOADS_DIR, { recursive: true }).catch(() => {});

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
    }
  },
});

async function saveLocally(
  buffer: Buffer,
  filename: string
): Promise<{ url: string; thumbUrl: string }> {
  const dir = path.join(UPLOADS_DIR);
  await fs.mkdir(dir, { recursive: true });

  // Compress main image — max 1200px, JPEG 0.8
  const mainBuf = await sharp(buffer)
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  // Thumbnail — 200×200
  const thumbBuf = await sharp(buffer)
    .resize(200, 200, { fit: 'cover' })
    .jpeg({ quality: 70 })
    .toBuffer();

  const mainFile = `${filename}.jpg`;
  const thumbFile = `${filename}_thumb.jpg`;

  await fs.writeFile(path.join(dir, mainFile), mainBuf);
  await fs.writeFile(path.join(dir, thumbFile), thumbBuf);

  return {
    url: `/uploads/${mainFile}`,
    thumbUrl: `/uploads/${thumbFile}`,
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

      // Check max photos
      const existing = await prisma.pvPhoto.count({
        where: { entry_id, deleted_at: null },
      });
      if (existing >= MAX_PHOTOS) {
        throw AppError.badRequest(`Maximum ${MAX_PHOTOS} photos per entry`);
      }

      const fileId = session_id ? `${session_id.slice(0, 8)}_${entry_id.slice(0, 8)}_${uuidv4()}` : uuidv4();

      const { url, thumbUrl } = await saveLocally(req.file.buffer, fileId);

      const photo = await prisma.pvPhoto.create({
        data: {
          entry_id,
          url,
          thumb_url: thumbUrl,
          s3_key: null,
        },
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

// DELETE /api/photos/:id (soft delete)
router.delete('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const photo = await prisma.pvPhoto.findUnique({ where: { id: req.params.id } });
    if (!photo || photo.deleted_at) throw AppError.notFound('Photo not found');

    await prisma.pvPhoto.update({
      where: { id: req.params.id },
      data: { deleted_at: new Date() },
    });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
