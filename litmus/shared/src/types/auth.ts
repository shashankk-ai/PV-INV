export type UserRole = 'ops' | 'admin';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}
