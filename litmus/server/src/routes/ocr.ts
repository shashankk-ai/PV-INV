import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../utils/AppError';
import { ok } from '../utils/respond';
import { logger } from '../utils/logger';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post(
  '/detect',
  requireAuth,
  upload.single('image'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ocrEnabled = process.env.OCR_ENABLED === 'true';
      if (!ocrEnabled) {
        ok(res, { detected_text: null, confidence: 0, enabled: false });
        return;
      }

      if (!req.file) throw AppError.badRequest('No image provided');

      // Lazy-load Tesseract to avoid startup cost
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');

      try {
        const { data } = await worker.recognize(req.file.buffer);
        const text = data.text?.trim() ?? '';
        const confidence = (data.confidence ?? 0) / 100; // normalize 0-100 → 0-1

        logger.debug({ text, confidence }, 'OCR result');
        ok(res, { detected_text: text || null, confidence, enabled: true });
      } finally {
        await worker.terminate();
      }
    } catch (err) {
      // Silent failure — OCR errors should never block the user
      logger.warn({ err }, 'OCR detection failed silently');
      ok(res, { detected_text: null, confidence: 0, enabled: false });
    }
  }
);

export default router;
