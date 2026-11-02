import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { registerSchema } from '../lib/validation/auth';
import { Layers, Loader2, AlertCircle, Eye, EyeOff, Lock, Mail, User as UserIcon, Check, X } from 'lucide-react';
import { OAuthButtons } from '../components/auth/OAuthButtons';

export function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const navigate = useNavigate();

  // Redirect if already authenticated
  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [isAuthenticated, isAuthLoading, navigate]);

  // Live password strength indicator checks
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecialChar = /[^A-Za-z0-9]/.test(password);

  const validate = (): boolean => {
    setNameError(null);
    setEmailError(null);
    setPasswordError(null);
    setError(null);

    const result = registerSchema.safeParse({ name, email, password });
    if (!result.success) {
      for (const issue of result.error.issues) {
        if (issue.path[0] === 'name' && !nameError) {
          setNameError(issue.message);
        }
        if (issue.path[0] === 'email' && !emailError) {
          setEmailError(issue.message);
        }
        if (issue.path[0] === 'password' && !passwordError) {
          setPasswordError(issue.message);
        }
      }
      return false;
    }
    return true;
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    if (nameError) setNameError(null);
    if (error) setError(null);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (emailError) setEmailError(null);
    if (error) setError(null);
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
    if (passwordError) setPasswordError(null);
    if (error) setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await register({ name, email, password });
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed';
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
            Join the Next Generation of Workspaces
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight">
            Collaborate without<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-indigo-300">
              friction or delay.
            </span>
          </h1>
          <p className="text-workspace-300 text-base md:text-lg leading-relaxed">
            Create an account to start collaborating on dynamic paper canvases with instant peer-to-peer synchronization.
          </p>
        </div>

        {/* Footer info */}
        <div className="relative z-10 text-xs text-workspace-400">
          &copy; {new Date().getFullYear()} SyncSpace Inc. All rights reserved.
        </div>
      </div>

      {/* Right Form Card Panel */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-6 sm:p-12 md:p-16 bg-white overflow-y-auto">
        <div className="w-full max-w-md space-y-7">
          
          {/* Header */}
          <div>
            <div className="flex items-center space-x-2.5 lg:hidden mb-6">
              <div className="bg-primary-600 p-2 rounded-xl text-white">
                <Layers size={20} />
              </div>
              <span className="text-xl font-bold text-workspace-900 tracking-tight">SyncSpace</span>
            </div>
            <h2 className="text-3xl font-bold text-workspace-900 tracking-tight">Create your account</h2>
            <p className="mt-2 text-sm text-workspace-500">
              Get started with SyncSpace in seconds. No credit card required.
            </p>
          </div>

          {/* Alert Banner for API Errors */}
          {error && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50/80 border border-red-200 text-red-700 animate-fadeIn">
              <AlertCircle className="w-5 h-5 mt-0.5 text-red-500 shrink-0" />
              <div className="text-sm font-medium">{error}</div>
            </div>
          )}

          <OAuthButtons />
          <div className="relative flex items-center" aria-hidden="true">
            <div className="flex-grow border-t border-workspace-200" />
            <span className="mx-4 text-xs font-medium text-workspace-400">OR SIGN UP WITH EMAIL</span>
            <div className="flex-grow border-t border-workspace-200" />
          </div>

          {/* Form */}
          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            {/* Name Field */}
            <div>
              <label className="block text-sm font-medium text-workspace-700 mb-1.5" htmlFor="register-name">
                Full name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-workspace-400">
                  <UserIcon size={18} />
                </div>
                <input
                  id="register-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={handleNameChange}
                  className={`w-full pl-10 pr-4 py-2.5 rounded-xl border ${
                    nameError ? 'border-red-300 focus:ring-red-200 focus:border-red-500' : 'border-workspace-200 focus:ring-primary-100 focus:border-primary-500'
                  } focus:outline-none focus:ring-4 transition-all bg-workspace-50/50 hover:bg-workspace-50 focus:bg-white text-workspace-900 text-sm`}
                  placeholder="Jane Doe"
                  disabled={isSubmitting}
                />
              </div>
              {nameError && <p className="mt-1.5 text-xs text-red-600">{nameError}</p>}
            </div>

            {/* Email Field */}
            <div>
              <label className="block text-sm font-medium text-workspace-700 mb-1.5" htmlFor="register-email">
                Email address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-workspace-400">
                  <Mail size={18} />
                </div>
                <input
                  id="register-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={handleEmailChange}
                  className={`w-full pl-10 pr-4 py-2.5 rounded-xl border ${
                    emailError ? 'border-red-300 focus:ring-red-200 focus:border-red-500' : 'border-workspace-200 focus:ring-primary-100 focus:border-primary-500'
                  } focus:outline-none focus:ring-4 transition-all bg-workspace-50/50 hover:bg-workspace-50 focus:bg-white text-workspace-900 text-sm`}
                  placeholder="jane@example.com"
                  disabled={isSubmitting}
                />
              </div>
              {emailError && <p className="mt-1.5 text-xs text-red-600">{emailError}</p>}
            </div>

            {/* Password Field */}
            <div>
              <label className="block text-sm font-medium text-workspace-700 mb-1.5" htmlFor="register-password">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-workspace-400">
                  <Lock size={18} />
                </div>
                <input
                  id="register-password"
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
                    {hasMinLength ? <Check size={14} className="text-emerald-500" /> : <X size={14} className="text-workspace-300" />}
                    <span>Min 8 characters</span>
                  </div>
                  <div className={`flex items-center gap-1.5 transition-colors ${hasUppercase ? 'text-emerald-600 font-medium' : 'text-workspace-500'}`}>
                    {hasUppercase ? <Check size={14} className="text-emerald-500" /> : <X size={14} className="text-workspace-300" />}
                    <span>1 uppercase letter</span>
                  </div>
                  <div className={`flex items-center gap-1.5 transition-colors ${hasNumber ? 'text-emerald-600 font-medium' : 'text-workspace-500'}`}>
                    {hasNumber ? <Check size={14} className="text-emerald-500" /> : <X size={14} className="text-workspace-300" />}
                    <span>1 number</span>
                  </div>
                  <div className={`flex items-center gap-1.5 transition-colors ${hasSpecialChar ? 'text-emerald-600 font-medium' : 'text-workspace-500'}`}>
                    {hasSpecialChar ? <Check size={14} className="text-emerald-500" /> : <X size={14} className="text-workspace-300" />}
                    <span>1 special character</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-3 flex items-center justify-center py-2.5 px-4 rounded-xl shadow-sm text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-4 focus:ring-primary-100 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Creating account...
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          {/* Footer Link to Login */}
          <div className="text-center pt-1">
            <p className="text-sm text-workspace-500">
              Already have an account?{' '}
              <Link to="/login" className="font-semibold text-primary-600 hover:text-primary-700 underline-offset-4 hover:underline">
                Sign in
              </Link>
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}

export default Register;
