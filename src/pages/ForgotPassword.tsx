import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { forgotPasswordSchema } from '../lib/validation/auth';
import { forgotPasswordApi } from '../lib/api/auth';
import { Layers, Loader2, AlertCircle, CheckCircle, Mail, ArrowLeft } from 'lucide-react';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const navigate = useNavigate();

  const validate = (): boolean => {
    setEmailError(null);
    setError(null);

    const result = forgotPasswordSchema.safeParse({ email });
    if (!result.success) {
      for (const issue of result.error.issues) {
        if (issue.path[0] === 'email' && !emailError) {
          setEmailError(issue.message);
        }
      }
      return false;
    }
    return true;
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (emailError) setEmailError(null);
    if (error) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await forgotPasswordApi({ email });
      setIsSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send reset email';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

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
            Secure Password Recovery
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight">
            Reset your<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-indigo-300">
              password securely.
            </span>
          </h1>
          <p className="text-workspace-300 text-base md:text-lg leading-relaxed">
            We'll send you a secure link to reset your password. The link will expire in 30 minutes for your security.
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
            <h2 className="text-3xl font-bold text-workspace-900 tracking-tight">Forgot your password?</h2>
            <p className="mt-2 text-sm text-workspace-500">
              Enter your email address and we'll send you a link to reset your password.
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
                If an account exists for this email, a password reset link has been sent.
              </div>
            </div>
          )}

          {/* Form */}
          {!isSuccess ? (
            <form className="space-y-5" onSubmit={handleSubmit} noValidate>
              {/* Email Field */}
              <div>
                <label className="block text-sm font-medium text-workspace-700 mb-1.5" htmlFor="forgot-email">
                  Email address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-workspace-400">
                    <Mail size={18} />
                  </div>
                  <input
                    id="forgot-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={handleEmailChange}
                    className={`w-full pl-10 pr-4 py-2.5 rounded-xl border ${
                      emailError ? 'border-red-300 focus:ring-red-200 focus:border-red-500' : 'border-workspace-200 focus:ring-primary-100 focus:border-primary-500'
                    } focus:outline-none focus:ring-4 transition-all bg-workspace-50/50 hover:bg-workspace-50 focus:bg-white text-workspace-900 text-sm`}
                    placeholder="alex@syncspace.dev"
                    disabled={isSubmitting}
                  />
                </div>
                {emailError && <p className="mt-1.5 text-xs text-red-600">{emailError}</p>}
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
                    Sending reset link...
                  </>
                ) : (
                  'Send reset link'
                )}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <button
                onClick={() => {
                  setIsSuccess(false);
                  setEmail('');
                }}
                className="w-full flex items-center justify-center py-2.5 px-4 rounded-xl shadow-sm text-sm font-semibold text-primary-600 bg-primary-50 hover:bg-primary-100 focus:outline-none focus:ring-4 focus:ring-primary-100 transition-all"
              >
                Send another reset link
              </button>
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

export default ForgotPassword;
