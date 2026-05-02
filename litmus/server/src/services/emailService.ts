import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM ?? SMTP_USER ?? 'noreply@litmus.app';

const transporter = SMTP_HOST && SMTP_USER && SMTP_PASS
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

export async function sendWelcomeEmail(opts: {
  to: string;
  username: string;
  password: string;
  role: 'ops' | 'admin';
  appUrl: string;
}): Promise<void> {
  if (!transporter) {
    logger.warn('SMTP not configured — skipping welcome email');
    return;
  }

  const roleLabel = opts.role === 'admin' ? 'Admin' : 'Ops (Warehouse Scanner)';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#2A1F68 0%,#4B3B8C 100%);padding:32px 40px;text-align:center;">
            <p style="margin:0;font-size:32px;font-weight:900;letter-spacing:4px;color:#ffffff;">LITMUS</p>
            <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.65);letter-spacing:1px;">THE INVENTORY TRUTH TEST</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0A1628;">Welcome to LITMUS 👋</p>
            <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">
              Your account has been created. Here are your login credentials:
            </p>

            <!-- Credentials box -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:28px;">
              <tr>
                <td style="padding:20px 24px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:6px 0;">
                        <span style="font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Username</span><br>
                        <span style="font-size:18px;font-weight:700;color:#0A1628;font-family:monospace;">${opts.username}</span>
                      </td>
                    </tr>
                    <tr><td style="padding:1px 0;"><hr style="border:none;border-top:1px solid #e2e8f0;margin:8px 0;"></td></tr>
                    <tr>
                      <td style="padding:6px 0;">
                        <span style="font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Password</span><br>
                        <span style="font-size:18px;font-weight:700;color:#0A1628;font-family:monospace;">${opts.password}</span>
                      </td>
                    </tr>
                    <tr><td style="padding:1px 0;"><hr style="border:none;border-top:1px solid #e2e8f0;margin:8px 0;"></td></tr>
                    <tr>
                      <td style="padding:6px 0;">
                        <span style="font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;">Role</span><br>
                        <span style="font-size:15px;font-weight:600;color:#4B3B8C;">${roleLabel}</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td align="center">
                  <a href="${opts.appUrl}" style="display:inline-block;background:linear-gradient(135deg,#0D9488,#0f766e);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 36px;border-radius:50px;box-shadow:0 4px 14px rgba(13,148,136,0.35);">
                    Open LITMUS →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;">
              ⚠️ <strong style="color:#92400e;">Please change your password</strong> after your first login for security.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">LITMUS · by Scimplify · This is an automated message</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: `"LITMUS" <${SMTP_FROM}>`,
      to: opts.to,
      subject: `Welcome to LITMUS — your account is ready`,
      html,
    });
    logger.info({ to: opts.to, username: opts.username }, 'Welcome email sent');
  } catch (err) {
    // Email failure must never block user creation
    logger.error({ err, to: opts.to }, 'Failed to send welcome email');
  }
}
