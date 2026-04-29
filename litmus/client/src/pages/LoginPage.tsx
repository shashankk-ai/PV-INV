import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../contexts/AuthContext';
import LitmusLogo from '../components/LitmusLogo';

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

type FormData = z.infer<typeof schema>;

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setServerError('');
    try {
      const u = await login(data.username, data.password);
      navigate(u.role === 'admin' ? '/admin' : '/sites');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        'Sign in failed. Check your credentials.';
      setServerError(msg);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <LitmusLogo size="lg" showTagline showByLine />
        </div>

        <h1 className="sr-only">LITMUS — Sign In</h1>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-navy mb-1.5" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              placeholder="Enter username"
              className={`input-field ${errors.username ? 'border-red-400 ring-1 ring-red-400' : ''}`}
              {...register('username')}
            />
            {errors.username && (
              <p className="mt-1 text-sm text-red-700">{errors.username.message}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium text-navy mb-1.5" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter password"
              className={`input-field ${errors.password ? 'border-red-400 ring-1 ring-red-400' : ''}`}
              {...register('password')}
            />
            {errors.password && (
              <p className="mt-1 text-sm text-red-700">{errors.password.message}</p>
            )}
          </div>

          {/* Server error */}
          {serverError && (
            <p className="text-sm text-red-700 font-medium text-center">{serverError}</p>
          )}

          {/* Submit */}
          <button type="submit" disabled={isSubmitting} className="btn-primary mt-2">
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <Spinner /> Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
