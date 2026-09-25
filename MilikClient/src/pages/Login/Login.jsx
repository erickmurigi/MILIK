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
    <div className="min-h-screen bg-white lg:grid lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">

      {/* ── Brand panel (large screens) ── */}
      <aside className="relative hidden items-center justify-center overflow-hidden bg-gradient-to-br from-[#0B3B2E] via-[#0A3127] to-[#06231b] lg:flex">
        {/* The two overlapping squares of the Milik mark, large and faint, centred behind the logo */}
        <svg aria-hidden="true" viewBox="0 0 400 400" className="pointer-events-none absolute inset-0 m-auto aspect-square h-auto w-[78%] max-w-[460px] select-none" fill="none" strokeWidth="10">
          <rect x="35" y="35" width="220" height="220" stroke="#FF8C00" strokeOpacity="0.24" />
          <rect x="145" y="145" width="220" height="220" stroke="#ffffff" strokeOpacity="0.13" />
        </svg>

        <div className="relative rounded-2xl bg-white px-7 py-5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55)]">
          <img src="/milik-logo-trim.png" alt="Milik System — One Platform. Every Business." className="h-11 w-auto xl:h-14" />
        </div>

        <p className="absolute bottom-6 left-0 right-0 text-center text-xs text-emerald-100/50">© {new Date().getFullYear()} Milik System</p>
      </aside>

      {/* ── Sign-in ── */}
      <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#f3f7f5] px-5 py-10 sm:px-10 lg:min-h-0">
        {/* one outlined square (the mark), top right, to sharpen the two soft clouds */}
        <svg aria-hidden="true" viewBox="0 0 200 200" className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 select-none sm:h-44 sm:w-44" fill="none">
          <rect x="30" y="30" width="150" height="150" stroke="#0B3B2E" strokeWidth="6" />
          <rect x="-10" y="70" width="150" height="150" stroke="#0B3B2E" strokeOpacity="0.22" strokeWidth="6" />
        </svg>
        {/* soft clouds of colour: orange at the top left, green at the bottom right */}
        <div aria-hidden="true" className="pointer-events-none absolute -left-32 -top-32 h-[26rem] w-[26rem] rounded-full bg-[#FF8C00]/20 blur-3xl sm:h-[34rem] sm:w-[34rem]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -right-32 h-[26rem] w-[26rem] rounded-full bg-[#0B3B2E]/20 blur-3xl sm:h-[34rem] sm:w-[34rem]" />
        <div className="relative w-full max-w-[26rem] rounded-2xl border border-slate-200/80 bg-white p-7 shadow-[0_20px_50px_-20px_rgba(11,59,46,0.25)] sm:p-9">

          <div className="mb-7 lg:hidden">
            <img src="/milik-logo-trim.png" alt="Milik System" className="mx-auto h-11 w-auto sm:h-12" />
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

          <p className="mt-7 border-t border-slate-100 pt-5 text-center text-sm font-medium text-slate-500">
            New to Milik?{' '}
            <Link to="/" className="font-bold text-[#0B3B2E] transition-colors hover:text-[#FF8C00]">
              Explore the public overview
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

export default Login;
