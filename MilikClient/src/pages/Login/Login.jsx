import React, { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import { FaEye, FaEyeSlash, FaEnvelope, FaLock, FaSpinner } from 'react-icons/fa';
import { toast } from 'react-toastify';
import { loginUser } from '../../redux/apiCalls';
import './login.css';

const POST_LOGOUT_LANDING_KEY = 'milik_post_logout_landing';

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

  return user?.isDemoUser ? '/dashboard' : '/moduleDashboard';
};


function Login() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');

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
      const result = await dispatch(loginUser(formData.email, formData.password));
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
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#eef5f1] via-[#e7f1eb] to-[#f4efe7] flex items-center justify-center p-4">
      <img
        src="/logo.png"
        alt="Milik watermark"
        className="pointer-events-none select-none absolute inset-0 m-auto w-[70vw] max-w-[760px] opacity-[0.13]"
      />

      <div className="relative w-full max-w-md">
        <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-2xl overflow-hidden border border-[#0B3B2E]/20">
          <div className="bg-gradient-to-r from-[#0B3B2E] to-[#0A3127] p-8 text-center">
            <div className="flex items-center justify-center gap-3 mb-2">
              <img
                src="/logo.png"
                alt="Milik logo"
                className="w-12 h-12 md:w-14 md:h-14 object-contain drop-shadow-md"
              />
              <h1 className="text-4xl font-extrabold tracking-wide text-white">Milik</h1>
            </div>
            <p className="text-[#DDEFE1] text-sm font-semibold">Property Management System</p>
          </div>

          <div className="p-8">
            <div className="mb-6 text-center">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#FF8C00]">Existing user sign in</p>
              <h2 className="mt-2 text-2xl font-extrabold text-[#0B3B2E] mb-1 text-center">Welcome Back</h2>
              <p className="text-center text-sm font-semibold text-slate-600">Sign in to continue to your live workspace</p>
              <Link to="/home" className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-[#0B3B2E] transition-colors hover:text-[#FF8C00]">
                ← Back to public overview
              </Link>
            </div>

            {serverError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg">
                <p className="text-sm font-semibold text-red-700 flex items-start gap-2">
                  <span>⚠️</span>
                  <span>{serverError}</span>
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-extrabold text-[#0B3B2E] mb-2 tracking-wide">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FaEnvelope className="text-[#0B3B2E]" />
                  </div>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    className={[
                      "w-full pl-10 pr-4 py-3 border-2 rounded-lg outline-none transition-all text-[#0B3B2E] font-bold placeholder:text-slate-500",
                      "focus:ring-2 focus:ring-[#0B3B2E]/20 focus:border-[#0B3B2E]",
                      errors.email ? "border-red-400 bg-red-50" : "border-[#b9d3c7] bg-white",
                    ].join(" ")}
                    placeholder="Enter your email"
                    disabled={loading}
                  />
                </div>
                {errors.email && <p className="mt-1 text-sm font-bold text-red-600">{errors.email}</p>}
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-extrabold text-[#0B3B2E] mb-2 tracking-wide">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FaLock className="text-[#0B3B2E]" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    className={[
                      "w-full pl-10 pr-12 py-3 border-2 rounded-lg outline-none transition-all text-[#0B3B2E] font-bold placeholder:text-slate-500",
                      "focus:ring-2 focus:ring-[#0B3B2E]/20 focus:border-[#0B3B2E]",
                      errors.password ? "border-red-400 bg-red-50" : "border-[#b9d3c7] bg-white",
                    ].join(" ")}
                    placeholder="Enter your password"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#0B3B2E] hover:text-[#FF8C00]"
                    disabled={loading}
                  >
                    {showPassword ? <FaEyeSlash /> : <FaEye />}
                  </button>
                </div>
                {errors.password && <p className="mt-1 text-sm font-bold text-red-600">{errors.password}</p>}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-[#0B3B2E] to-[#0A3127] text-white py-3 px-4 rounded-lg font-extrabold tracking-wide hover:shadow-lg hover:from-[#0A3127] hover:to-[#0B3B2E] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <FaSpinner className="animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-sm font-semibold text-slate-600">
                New to Milik?{' '}
                <Link to="/home" className="font-extrabold text-[#0B3B2E] hover:text-[#FF8C00] transition-colors">
                  Explore the public overview
                </Link>
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
