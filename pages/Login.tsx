import React, { useState } from 'react';

import { api } from '../lib/api';
import { User } from '../types';

interface LoginProps {
  onLogin: (user: User) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await api.auth.login(email, password);
      onLogin(user);
    } catch (error: any) {
      alert(error.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-[#F9F8F6]">
      {/* Visual Side */}
      <div className="hidden lg:flex w-1/2 bg-primary items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-black opacity-40 z-10"></div>
        <img
          src="https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?q=80&w=2653&auto=format&fit=crop"
          alt="Architecture"
          className="absolute inset-0 w-full h-full object-cover grayscale"
        />
        <div className="relative z-20 text-center p-12">
          <img
            src="/MONO logo (2).png"
            alt="Mono Atelier Logo"
            className="w-48 mx-auto mb-8 invert brightness-0"
          />
          <p className="text-white text-xs uppercase tracking-[0.3em] opacity-80 mb-4 font-light">Precision in every detail</p>
          <h1 className="font-serif italic text-6xl text-white">Mono Atelier</h1>
        </div>
      </div>

      {/* Form Side */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-12">
        <div className="w-full max-w-md">
          <div className="mb-12 text-center lg:text-left">
            <h2 className="font-serif text-4xl mb-2 text-primary">Secure Authentication</h2>
            <p className="text-gray-500 text-sm font-light">Enter your credentials to access the OS.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-transparent border-b border-gray-300 py-3 text-lg focus:outline-none focus:border-primary transition-colors"
                placeholder="name@firm.com"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent border-b border-gray-300 py-3 text-lg focus:outline-none focus:border-primary transition-colors"
                placeholder="••••••••"
              />
            </div>

            <div className="flex items-center gap-4 p-4 bg-gray-100 rounded-sm">
              <span className="material-icons text-gray-400">shield</span>
              <span className="text-xs text-gray-500">MFA Verification required on next step.</span>
            </div>

            <button
              type="submit"
              className="w-full bg-primary text-white py-4 text-xs font-bold uppercase tracking-widest hover:bg-black transition-all shadow-xl hover:shadow-2xl"
            >
              Sign In
            </button>
          </form>
          <div className="mt-8 text-center">
            <p className="text-xs text-gray-400 cursor-pointer hover:text-primary transition-colors">Forgot Password?</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
