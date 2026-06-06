import { useState } from 'react';
import { supabase } from '../lib/supabase';

type View = 'login' | 'forgot' | 'reset';

interface LoginProps {
  isRecovery?: boolean;
  onRecoveryComplete?: () => void;
}

const Login: React.FC<LoginProps> = ({ isRecovery = false, onRecoveryComplete }) => {
  const [view, setView] = useState<View>(isRecovery ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setError(error.message);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/`
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setMessage('Check your email for a password reset link.');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      onRecoveryComplete?.();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900 overflow-y-auto">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[120px]"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/20 rounded-full blur-[120px]"></div>

      <div className="w-full max-w-md p-8 relative">
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-10 shadow-2xl space-y-8">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-slate-900 font-black text-3xl mx-auto mb-4 shadow-xl">
              ✝
            </div>
            <h1 className="text-3xl font-black text-white tracking-tighter">The Heaven Guy</h1>
            <p className="text-slate-400 font-medium text-sm uppercase tracking-widest">Church Database</p>
          </div>

          {/* ── Login ── */}
          {view === 'login' && (
            <form onSubmit={handleLogin} className="space-y-6">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest ml-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  className="w-full bg-slate-800/50 border border-slate-700 text-black px-4 py-3 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-600"
                  placeholder="you@example.com"
                  required
                  disabled={loading}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest ml-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full bg-slate-800/50 border border-slate-700 text-black px-4 py-3 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-600"
                  placeholder="••••••••••••"
                  required
                  disabled={loading}
                />
              </div>

              {error && <ErrorBanner message={error} />}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-white hover:bg-slate-100 disabled:bg-slate-400 text-slate-900 font-black py-4 rounded-xl shadow-lg transition-all active:scale-[0.98] uppercase tracking-widest text-sm flex items-center justify-center gap-2"
              >
                {loading ? <Spinner /> : 'Login'}
              </button>

              <button
                type="button"
                onClick={() => { setView('forgot'); setError(''); setMessage(''); }}
                className="w-full text-center text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                Forgot password?
              </button>
            </form>
          )}

          {/* ── Forgot Password ── */}
          {view === 'forgot' && (
            <form onSubmit={handleForgotPassword} className="space-y-6">
              <p className="text-slate-300 text-sm text-center leading-relaxed">
                Enter your account email and we'll send you a password reset link.
              </p>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest ml-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  className="w-full bg-slate-800/50 border border-slate-700 text-black px-4 py-3 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-600"
                  placeholder="you@example.com"
                  required
                  disabled={loading || !!message}
                />
              </div>

              {error && <ErrorBanner message={error} />}
              {message && <SuccessBanner message={message} />}

              {!message && (
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-white hover:bg-slate-100 disabled:bg-slate-400 text-slate-900 font-black py-4 rounded-xl shadow-lg transition-all active:scale-[0.98] uppercase tracking-widest text-sm flex items-center justify-center gap-2"
                >
                  {loading ? <Spinner /> : 'Send Reset Link'}
                </button>
              )}

              <button
                type="button"
                onClick={() => { setView('login'); setError(''); setMessage(''); }}
                className="w-full text-center text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                Back to login
              </button>
            </form>
          )}

          {/* ── Reset Password ── */}
          {view === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-6">
              <p className="text-slate-300 text-sm text-center leading-relaxed">
                Choose a new password for your account.
              </p>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest ml-1">New Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full bg-slate-800/50 border border-slate-700 text-black px-4 py-3 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-600"
                  placeholder="••••••••••••"
                  required
                  disabled={loading}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest ml-1">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full bg-slate-800/50 border border-slate-700 text-black px-4 py-3 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-600"
                  placeholder="••••••••••••"
                  required
                  disabled={loading}
                />
              </div>

              {error && <ErrorBanner message={error} />}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-white hover:bg-slate-100 disabled:bg-slate-400 text-slate-900 font-black py-4 rounded-xl shadow-lg transition-all active:scale-[0.98] uppercase tracking-widest text-sm flex items-center justify-center gap-2"
              >
                {loading ? <Spinner /> : 'Set New Password'}
              </button>
            </form>
          )}


        </div>
      </div>
    </div>
  );
};

const Spinner = () => (
  <div className="w-4 h-4 border-2 border-slate-600 border-t-transparent rounded-full animate-spin" />
);

const ErrorBanner = ({ message }: { message: string }) => (
  <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-lg flex items-center gap-3 text-red-400 text-xs font-bold">
    <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
    {message}
  </div>
);

const SuccessBanner = ({ message }: { message: string }) => (
  <div className="bg-green-500/10 border border-green-500/20 p-3 rounded-lg flex items-center gap-3 text-green-400 text-xs font-bold">
    <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
    {message}
  </div>
);

export default Login;
