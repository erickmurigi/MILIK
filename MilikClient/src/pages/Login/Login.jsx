import React, { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import { FaEye, FaEyeSlash, FaEnvelope, FaLock } from 'react-icons/fa';
import Spinner from '../../components/common/Spinner';
import { toast } from 'react-toastify';
import { loginUser } from '../../redux/apiCalls';
import './login.css';

const POST_LOGOUT_LANDING_KEY = 'milik_post_logout_landing';

const PUBLIC_SITE_URL = 'https://milikproperty.com';

const ensureHeadElement = (selector, tagName, attributes = {}) => {
  let element = document.head.querySelector(selector);

  if (!element) {
    element = document.createElement(tagName);
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    document.head.appendChild(element);
  }

  return element;
};

const setDocumentDescription = (content) => {
  ensureHeadElement('meta[name="description"]', 'meta', { name: 'description' }).setAttribute('content', content);
};

const setDocumentRobots = (content) => {
  ensureHeadElement('meta[name="robots"]', 'meta', { name: 'robots' }).setAttribute('content', content);
};

const setCanonicalHref = (href) => {
  ensureHeadElement('link[rel="canonical"]', 'link', { rel: 'canonical' }).setAttribute('href', href);
};

const consumePostLogoutLanding = () => {
  try {
    const target = sessionStorage.getItem(POST_LOGOUT_LANDING_KEY);
    if (target) {
      sessionStorage.removeItem(POST_LOGOUT_LANDING_KEY);
      return target;
    }
  } catch (_error) {
    // Ignore storage issues and continue with default routing.
  }
  return '';
};

const resolvePostLoginRoute = (user) => {
  if (user?.mustChangePassword && !user?.isSystemAdmin && !user?.superAdminAccess) {
    return '/first-time-password';
  }

  const forcedLanding = consumePostLogoutLanding();
  if (forcedLanding) {
    return `/${String(forcedLanding).replace(/^\/+/, '')}`;
  }

  return '/moduleDashboard';
};


function Login() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    document.title = 'Sign in | Milik';
    setDocumentDescription('Secure sign in for the Milik Property Management System workspace.');
    setDocumentRobots('noindex,nofollow');
    setCanonicalHref(`${PUBLIC_SITE_URL}/login`);
  }, []);

  useEffect(() => {
    // Check if already logged in
    const token = localStorage.getItem('milik_token');
    if (token) {
      const storedUser = (() => {
        try {
          return JSON.parse(localStorage.getItem('milik_user') || 'null');
        } catch {
          return null;
        }
      })();

      navigate(resolvePostLoginRoute(storedUser), { replace: true });
    }
  }, [navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
    if (serverError) {
      setServerError('');
    }
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }
    
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }
    
    return newErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const validationErrors = validateForm();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    
    setLoading(true);
    setServerError('');
    
    try {
      const result = await dispatch(loginUser(formData.email.trim().toLowerCase(), formData.password));
      toast.success('Login successful!');
      setServerError('');
      navigate(resolvePostLoginRoute(result?.user), { replace: true });
    } catch (err) {
      let errorMessage = 'Login failed. Please try again.';
      
      // Extract error message from different error sources
      if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      } else if (err.response?.data?.error) {
        errorMessage = err.response.data.error;
      } else if (err.response?.data?.msg) {
        errorMessage = err.response.data.msg;
      } else if (err.message && err.message !== 'Unauthorized') {
        errorMessage = err.message;
      } else if (err.response?.statusText && err.response?.statusText !== 'Unauthorized') {
        errorMessage = err.response.statusText;
      }
      
      // Handle specific HTTP status codes
      if (err.response?.status === 401) {
        errorMessage = 'Invalid email or password';
      } else if (err.response?.status === 400) {
        errorMessage = 'Invalid email or password';
      } else if (err.response?.status === 403) {
        if (errorMessage.includes('inactive')) {
          errorMessage = 'Your account is inactive. Please contact support.';
        } else if (errorMessage.includes('locked')) {
          errorMessage = 'Your account is locked. Please contact support.';
        }
      } else if (err.response?.status === 404) {
        errorMessage = 'User not found. Please check your email.';
      } else if (err.response?.status === 500) {
        errorMessage = 'Server error. Please try again later.';
      } else if (!err.response) {
        errorMessage = 'Network error. Please check your connection and try again.';
      }
      
      setServerError(errorMessage);
      toast.error(errorMessage);
      console.error('Login error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">

      {/* ── Brand panel (large screens) ── */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[#0B3B2E] via-[#0A3127] to-[#06231b] text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 border-[36px] border-[#FF8C00]/10" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-[28rem] w-[28rem] border-[36px] border-white/5" />

        <div className="relative">
          <div className="inline-block rounded-xl bg-white px-6 py-4 shadow-xl">
            <img src="/milik-logo-trim.png" alt="Milik System — One Platform. Every Business." className="h-14 w-auto xl:h-16" />
          </div>
        </div>

        <div className="relative max-w-xl">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#FF8C00]">Milik System</p>
          <h1 className="mt-4 text-3xl font-extrabold leading-tight xl:text-4xl">
            Every part of your business, in one place.
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-emerald-100/80">
            Properties, accounts, people, stock and sales share one set of books, so what you see is always the same everywhere.
          </p>
          <ul className="mt-8 grid max-w-md grid-cols-2 gap-x-6 gap-y-3 text-sm font-semibold text-emerald-50">
            {['Property management', 'Accounts & ledger', 'Human resources', 'Inventory & POS', 'Property sales', 'Car wash'].map((label) => (
              <li key={label} className="flex items-center gap-2.5">
                <span className="h-2 w-2 shrink-0 bg-[#FF8C00]" />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-emerald-100/60">© {new Date().getFullYear()} Milik System. All rights reserved.</p>
      </aside>

      {/* ── Sign-in ── */}
      <main className="flex min-h-screen flex-col justify-center bg-white px-6 py-10 sm:px-12 lg:min-h-0">
        <div className="mx-auto w-full max-w-md">

          <div className="mb-8 lg:hidden">
            <img src="/milik-logo-trim.png" alt="Milik System" className="mx-auto h-12 w-auto sm:h-14" />
          </div>

          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#FF8C00]">Existing user sign in</p>
          <h2 className="mt-2 text-3xl font-extrabold text-[#0B3B2E]">Welcome back</h2>
          <p className="mt-1.5 text-sm font-medium text-slate-500">Sign in to continue to your workspace.</p>

          {serverError && (
            <div role="alert" className="mt-6 flex items-start gap-2.5 border-l-4 border-red-500 bg-red-50 px-4 py-3">
              <span aria-hidden="true">⚠️</span>
              <p className="text-sm font-semibold text-red-700">{serverError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-7 space-y-5" noValidate>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-bold text-[#0B3B2E]">Email address</label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                  <FaEnvelope className="text-slate-400" />
                </div>
                <input
                  type="email"
                  id="email"
                  name="email"
                  autoComplete="username"
                  autoFocus
                  value={formData.email}
                  onChange={handleChange}
                  className={[
                    'w-full rounded-lg border bg-white py-3 pl-10 pr-4 text-[15px] font-semibold text-[#0B3B2E] outline-none transition placeholder:font-normal placeholder:text-slate-400',
                    'focus:border-[#0B3B2E] focus:ring-4 focus:ring-[#0B3B2E]/10',
                    errors.email ? 'border-red-400 bg-red-50' : 'border-slate-300',
                  ].join(' ')}
                  placeholder="you@company.com"
                  disabled={loading}
                />
              </div>
              {errors.email && <p className="mt-1 text-sm font-semibold text-red-600">{errors.email}</p>}
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-bold text-[#0B3B2E]">Password</label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                  <FaLock className="text-slate-400" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  value={formData.password}
                  onChange={handleChange}
                  onKeyUp={(e) => setCapsLock(e.getModifierState?.('CapsLock') === true)}
                  onBlur={() => setCapsLock(false)}
                  className={[
                    'w-full rounded-lg border bg-white py-3 pl-10 pr-12 text-[15px] font-semibold text-[#0B3B2E] outline-none transition placeholder:font-normal placeholder:text-slate-400',
                    'focus:border-[#0B3B2E] focus:ring-4 focus:ring-[#0B3B2E]/10',
                    errors.password ? 'border-red-400 bg-red-50' : 'border-slate-300',
                  ].join(' ')}
                  placeholder="Enter your password"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 hover:text-[#0B3B2E]"
                  disabled={loading}
                >
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
              {capsLock && <p className="mt-1 text-xs font-bold text-amber-600">Caps Lock is on</p>}
              {errors.password && <p className="mt-1 text-sm font-semibold text-red-600">{errors.password}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0B3B2E] px-4 py-3.5 text-[15px] font-extrabold tracking-wide text-white shadow-md transition hover:bg-[#0A3127] hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-[#0B3B2E]/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Spinner size="sm" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-sm font-medium text-slate-500">
            New to Milik?{' '}
            <Link to="/" className="font-bold text-[#0B3B2E] transition-colors hover:text-[#FF8C00]">
              Explore the public overview
            </Link>
          </p>
          <p className="mt-10 text-center text-xs text-slate-400 lg:hidden">© {new Date().getFullYear()} Milik System</p>
        </div>
      </main>
    </div>
  );
}

export default Login;
