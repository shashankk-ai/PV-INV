import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from './prisma';
import { AuthUser } from '@litmus/shared';

const ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const REFRESH_EXPIRY_DAYS = 7;

function accessSecret(): string {
  if (!process.env.JWT_ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET not set');
  return process.env.JWT_ACCESS_SECRET;
}

function refreshSecret(): string {
  if (!process.env.JWT_REFRESH_SECRET) throw new Error('JWT_REFRESH_SECRET not set');
  return process.env.JWT_REFRESH_SECRET;
}

export function signAccess(user: AuthUser): string {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, accessSecret(), {
    expiresIn: ACCESS_EXPIRY,
  } as jwt.SignOptions);
}

export async function issueRefresh(userId: string): Promise<string> {
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_DAYS * 86400 * 1000);
  await prisma.refreshToken.create({ data: { user_id: userId, token, expires_at: expiresAt } });
  return token;
}

export async function rotateRefresh(
  oldToken: string
): Promise<{ user: AuthUser; accessToken: string; refreshToken: string } | null> {
  const record = await prisma.refreshToken.findUnique({ where: { token: oldToken } });
  if (!record || record.revoked || record.expires_at < new Date()) return null;

  await prisma.refreshToken.update({ where: { id: record.id }, data: { revoked: true } });

  const user = await prisma.user.findUnique({ where: { id: record.user_id } });
  if (!user) return null;

  const authUser: AuthUser = { id: user.id, username: user.username, role: user.role as 'ops' | 'admin' };
  const accessToken = signAccess(authUser);
  const refreshToken = await issueRefresh(user.id);
  return { user: authUser, accessToken, refreshToken };
}

export function verifyRefreshToken(_token: string): boolean {
  return true;
}
