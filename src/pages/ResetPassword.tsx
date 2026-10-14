import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { resetPasswordSchema } from '../lib/validation/auth';
import { resetPasswordApi } from '../lib/api/auth';
import { useAuth } from '../context/AuthContext';
import { Layers, Loader2, AlertCircle, CheckCircle, Eye, EyeOff, Lock, ArrowLeft } from 'lucide-react';

export function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [isTokenValid, setIsTokenValid] = useState(true);

  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();

  // Extract token from URL on mount
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const fragmentParams = new URLSearchParams(location.hash.replace(/^#/, ''));
    const tokenParam = fragmentParams.get('token') || searchParams.get('token');
    if (!tokenParam) {
      setIsTokenValid(false);
      setError('This reset link is invalid, expired, or already used. Please request a new password reset.');
    } else {
      setToken(tokenParam);
      // Keep the single-use token out of browser history after the page has read it.
      if (fragmentParams.has('token') || searchParams.has('token')) {
        const cleanSearch = new URLSearchParams(location.search);
        cleanSearch.delete('token');
        const cleanQuery = cleanSearch.toString();
        window.history.replaceState(null, '', `${location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`);
      }
    }
  }, [location.hash, location.pathname, location.search]);

  // Live password strength indicator checks
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = /[^A-Za-z0-9]/.test(password);

  const validate = (): boolean => {
    setPasswordError(null);
    setConfirmPasswordError(null);
    setError(null);

    const result = resetPasswordSchema.safeParse({ 
      token: token || '', 
      password, 
      confirmPassword 
    });
    
    if (!result.success) {
      for (const issue of result.error.issues) {
        if (issue.path[0] === 'password' && !passwordError) {
          setPasswordError(issue.message);
        }
        if (issue.path[0] === 'confirmPassword' && !confirmPasswordError) {
          setConfirmPasswordError(issue.message);
        }
        if (issue.path[0] === 'token' && !error) {
          setError(issue.message);
        }
      }
      return false;
    }
    return true;
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    if (passwordError) setPasswordError(null);
    if (error) setError(null);
  };

  const handleConfirmPasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setConfirmPassword(e.target.value);
    if (confirmPasswordError) setConfirmPasswordError(null);
    if (error) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await resetPasswordApi({ 
        token: token || '', 
        password,
        confirmPassword,
      });
      // Clear any in-memory client session as well as the invalidated server cookie.
      await logout();
      setIsSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reset password';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isTokenValid) {
    return (
      <div className="min-h-screen flex w-full bg-workspace-50">
        {/* Left Branding Panel */}
        <div className="hidden lg:flex lg:w-1/2 bg-workspace-900 flex-col justify-between p-12 relative overflow-hidden text-white">
          <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.2) 0%, transparent 50%)' }}></div>
          <div className="absolute bottom-0 right-0 w-full h-full opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 80% 80%, rgba(255,255,255,0.2) 0%, transparent 50%)' }}></div>

          {/* Top Logo */}
          <div className="flex items-center space-x-3 z-10">
            <div className="bg-primary-500/20 border border-primary-400/30 p-2.5 rounded-xl backdrop-blur-md">
              <Layers size={24} className="text-primary-400" />
            </div>
            <span className="text-2xl font-bold tracking-tight text-white">SyncSpace</span>
          </div>

          {/* Center Hero Copy */}
          <div className="relative z-10 max-w-lg space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-xs font-semibold text-red-300">
              Invalid Reset Link
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight">
              Reset link<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-orange-300">
                is invalid or expired.
              </span>
            </h1>
            <p className="text-workspace-300 text-base md:text-lg leading-relaxed">
              The password reset link you clicked is invalid or has expired. Please request a new one.
            </p>
          </div>

          {/* Footer info */}
          <div className="relative z-10 text-xs text-workspace-400">
            &copy; {new Date().getFullYear()} SyncSpace Inc. All rights reserved.
          </div>
        </div>

        {/* Right Form Card Panel */}
        <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-6 sm:p-12 md:p-16 bg-white">
          <div className="w-full max-w-md space-y-8">
            
            {/* Header */}
            <div>
              <div className="flex items-center space-x-2.5 lg:hidden mb-6">
                <div className="bg-primary-600 p-2 rounded-xl text-white">
                  <Layers size={20} />
                </div>
                <span className="text-xl font-bold text-workspace-900 tracking-tight">SyncSpace</span>
              </div>
              <h2 className="text-3xl font-bold text-workspace-900 tracking-tight">Invalid Reset Link</h2>
              <p className="mt-2 text-sm text-workspace-500">
                The password reset link you clicked is invalid or has expired.
              </p>
            </div>

            {/* Alert Banner */}
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50/80 border border-red-200 text-red-700 animate-fadeIn">
              <AlertCircle className="w-5 h-5 mt-0.5 text-red-500 shrink-0" />
              <div className="text-sm font-medium">
                Please request a new password reset link.
              </div>
            </div>

            {/* Button to request new link */}
            <Link
              to="/forgot-password"
              className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl shadow-sm text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary-100 transition-all"
            >
              Request new reset link
            </Link>

            {/* Footer Link to Login */}
            <div className="text-center pt-2">
              <Link to="/login" className="inline-flex items-center text-sm text-workspace-500 hover:text-workspace-700 transition-colors">
                <ArrowLeft size={16} className="mr-1" />
                Back to Sign In
              </Link>
            </div>

          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex w-full bg-workspace-50">
      {/* Left Branding Panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-workspace-900 flex-col justify-between p-12 relative overflow-hidden text-white">
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.2) 0%, transparent 50%)' }}></div>
        <div className="absolute bottom-0 right-0 w-full h-full opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 80% 80%, rgba(255,255,255,0.2) 0%, transparent 50%)' }}></div>

        {/* Top Logo */}
        <div className="flex items-center space-x-3 z-10">
          <div className="bg-primary-500/20 border border-primary-400/30 p-2.5 rounded-xl backdrop-blur-md">
            <Layers size={24} className="text-primary-400" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-white">SyncSpace</span>
        </div>

        {/* Center Hero Copy */}
        <div className="relative z-10 max-w-lg space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-500/10 border border-primary-500/20 text-xs font-semibold text-primary-300">
            Set New Password
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight">
            Create a<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-indigo-300">
              secure new password.
            </span>
          </h1>
          <p className="text-workspace-300 text-base md:text-lg leading-relaxed">
            Choose a strong password to protect your SyncSpace account. Make sure it's different from your previous passwords.
          </p>
        </div>

        {/* Footer info */}
        <div className="relative z-10 text-xs text-workspace-400">
          &copy; {new Date().getFullYear()} SyncSpace Inc. All rights reserved.
        </div>
      </div>

      {/* Right Form Card Panel */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-6 sm:p-12 md:p-16 bg-white">
        <div className="w-full max-w-md space-y-8">
          
          {/* Header */}
          <div>
            <div className="flex items-center space-x-2.5 lg:hidden mb-6">
              <div className="bg-primary-600 p-2 rounded-xl text-white">
                <Layers size={20} />
              </div>
              <span className="text-xl font-bold text-workspace-900 tracking-tight">SyncSpace</span>
            </div>
            <h2 className="text-3xl font-bold text-workspace-900 tracking-tight">Reset your password</h2>
            <p className="mt-2 text-sm text-workspace-500">
              Enter your new password below to complete the reset.
            </p>
          </div>

          {/* Alert Banner for API Errors */}
          {error && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50/80 border border-red-200 text-red-700 animate-fadeIn">
              <AlertCircle className="w-5 h-5 mt-0.5 text-red-500 shrink-0" />
              <div className="text-sm font-medium">{error}</div>
            </div>
          )}

          {/* Success Banner */}
          {isSuccess && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-50/80 border border-emerald-200 text-emerald-700 animate-fadeIn">
              <CheckCircle className="w-5 h-5 mt-0.5 text-emerald-500 shrink-0" />
              <div className="text-sm font-medium">
                Password has been reset successfully! You can now sign in with your new password.
              </div>
            </div>
          )}

          {/* Form */}
          {!isSuccess ? (
            <form className="space-y-5" onSubmit={handleSubmit} noValidate>
              {/* New Password Field */}
              <div>
                <label className="block text-sm font-medium text-workspace-700 mb-1.5" htmlFor="reset-password">
                  New password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-workspace-400">
                    <Lock size={18} />
                  </div>
                  <input
                    id="reset-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={handlePasswordChange}
                    className={`w-full pl-10 pr-11 py-2.5 rounded-xl border ${
                      passwordError ? 'border-red-300 focus:ring-red-200 focus:border-red-500' : 'border-workspace-200 focus:ring-primary-100 focus:border-primary-500'
                    } focus:outline-none focus:ring-4 transition-all bg-workspace-50/50 hover:bg-workspace-50 focus:bg-white text-workspace-900 text-sm`}
                    placeholder="••••••••"
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-workspace-400 hover:text-workspace-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {passwordError && <p className="mt-1.5 text-xs text-red-600">{passwordError}</p>}

                {/* Live Password Helper Checklist */}
                <div className="mt-3 p-3 bg-workspace-50 rounded-xl border border-workspace-200/80 space-y-2">
                  <p className="text-xs font-semibold text-workspace-600">Password requirements:</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className={`flex items-center gap-1.5 transition-colors ${hasMinLength ? 'text-emerald-600 font-medium' : 'text-workspace-500'}`}>
                      <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${hasMinLength ? 'bg-emerald-500' : 'bg-workspace-300'}`}>
                        {hasMinLength && <span className="text-white text-xs">✓</span>}
                      </div>
                      <span>Min 8 characters</span>
                    </div>
                    <div className={`flex items-center gap-1.5 transition-colors ${hasUppercase ? 'text-emerald-600 font-medium' : 'text-workspace-500'}`}>
                      <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${hasUppercase ? 'bg-emerald-500' : 'bg-workspace-300'}`}>
                        {hasUppercase && <span className="text-white text-xs">✓</span>}
                      </div>
                      <span>1 uppercase letter</span>
                    </div>
                    <div className={`flex items-center gap-1.5 transition-colors ${hasNumber ? 'text-emerald-600 font-medium' : 'text-workspace-500'}`}>
                      <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${hasNumber ? 'bg-emerald-500' : 'bg-workspace-300'}`}>
                        {hasNumber && <span className="text-white text-xs">✓</span>}
                      </div>
                      <span>1 number</span>
                    </div>
                    <div className={`flex items-center gap-1.5 transition-colors ${hasSpecialChar ? 'text-emerald-600 font-medium' : 'text-workspace-500'}`}>
                      <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${hasSpecialChar ? 'bg-emerald-500' : 'bg-workspace-300'}`}>
                        {hasSpecialChar && <span className="text-white text-xs">✓</span>}
                      </div>
                      <span>1 special character</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Confirm Password Field */}
              <div>
                <label className="block text-sm font-medium text-workspace-700 mb-1.5" htmlFor="reset-confirm-password">
                  Confirm new password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-workspace-400">
                    <Lock size={18} />
                  </div>
                  <input
                    id="reset-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={handleConfirmPasswordChange}
                    className={`w-full pl-10 pr-11 py-2.5 rounded-xl border ${
                      confirmPasswordError ? 'border-red-300 focus:ring-red-200 focus:border-red-500' : 'border-workspace-200 focus:ring-primary-100 focus:border-primary-500'
                    } focus:outline-none focus:ring-4 transition-all bg-workspace-50/50 hover:bg-workspace-50 focus:bg-white text-workspace-900 text-sm`}
                    placeholder="••••••••"
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-workspace-400 hover:text-workspace-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {confirmPasswordError && <p className="mt-1.5 text-xs text-red-600">{confirmPasswordError}</p>}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-2 flex items-center justify-center py-2.5 px-4 rounded-xl shadow-sm text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary-100 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Resetting password...
                  </>
                ) : (
                  'Reset password'
                )}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <Link
                to="/login"
                className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl shadow-sm text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary-100 transition-all"
              >
                Sign in with new password
              </Link>
            </div>
          )}

          {/* Footer Link to Login */}
          <div className="text-center pt-2">
            <Link to="/login" className="inline-flex items-center text-sm text-workspace-500 hover:text-workspace-700 transition-colors">
              <ArrowLeft size={16} className="mr-1" />
              Back to Sign In
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}

export default ResetPassword;
