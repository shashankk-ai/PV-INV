import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../contexts/AuthContext';

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
    <div className="min-h-screen bg-gradient-to-br from-[#0A1628] via-[#1e1548] to-[#4B3B8C] flex flex-col items-center justify-center px-6">
      {/* Decorative blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-teal-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-16 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative z-10 animate-scale-in">
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <LogoLight />
        </div>

        <h1 className="sr-only">LITMUS — Sign In</h1>

        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl px-6 py-8 shadow-2xl">
          <p className="text-white/70 text-sm font-medium mb-6 text-center">Sign in to continue</p>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            {/* Username */}
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1.5 uppercase tracking-wide" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                placeholder="Enter username"
                className={`w-full h-touch rounded-2xl border px-4 text-base
                  bg-white/10 text-white placeholder:text-white/40
                  focus:outline-none focus:ring-2 focus:ring-teal/60 focus:border-teal/60
                  transition-shadow duration-150
                  ${errors.username ? 'border-red-400/60 ring-1 ring-red-400/60' : 'border-white/20'}`}
                {...register('username')}
              />
              {errors.username && (
                <p className="mt-1 text-xs text-red-300">{errors.username.message}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1.5 uppercase tracking-wide" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter password"
                className={`w-full h-touch rounded-2xl border px-4 text-base
                  bg-white/10 text-white placeholder:text-white/40
                  focus:outline-none focus:ring-2 focus:ring-teal/60 focus:border-teal/60
                  transition-shadow duration-150
                  ${errors.password ? 'border-red-400/60 ring-1 ring-red-400/60' : 'border-white/20'}`}
                {...register('password')}
              />
              {errors.password && (
                <p className="mt-1 text-xs text-red-300">{errors.password.message}</p>
              )}
            </div>

            {/* Server error */}
            {serverError && (
              <div className="rounded-xl bg-red-500/20 border border-red-400/30 px-3 py-2">
                <p className="text-sm text-red-300 font-medium text-center">{serverError}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 h-touch-lg rounded-2xl font-semibold text-base
                bg-gradient-to-r from-teal-500 to-teal-600
                text-white shadow-lg shadow-teal-500/30
                flex items-center justify-center gap-2
                active:scale-[0.97] transition-all duration-150
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Spinner /> Signing in…
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        <p className="text-white/30 text-xs text-center mt-6">
          LITMUS · by Scimplify
        </p>
      </div>
    </div>
  );
}

function LogoLight() {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center font-bold tracking-widest text-5xl text-white">
        <span>L</span>
        <span className="relative inline-flex items-center justify-center mx-0.5">
          <svg className="h-12 w-6 text-teal-400" viewBox="0 0 12 28" fill="currentColor" aria-hidden="true">
            <rect x="3" y="0" width="6" height="18" rx="1" />
            <ellipse cx="6" cy="20" rx="3.5" ry="4" />
            <rect x="3" y="13" width="6" height="7" fill="white" fillOpacity="0.35" />
            <rect x="1" y="-1" width="10" height="3" rx="1.5" fill="currentColor" />
          </svg>
        </span>
        <span>TMUS</span>
      </div>
      <p className="text-white/50 text-sm tracking-wide">The inventory truth test.</p>
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
