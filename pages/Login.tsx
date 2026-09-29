import React, { useState } from 'react';

import { api } from '../lib/api';
import { User } from '../types';

interface LoginProps {
  onLogin: (user: User) => void;
  /** se llegó desde el correo de restablecer contraseña */
  recuperando?: boolean;
}

type Modo = 'entrar' | 'olvide' | 'nueva';

const Login: React.FC<LoginProps> = ({ onLogin, recuperando = false }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading] = useState(false);
  const [modo, setModo] = useState<Modo>(recuperando ? 'nueva' : 'entrar');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // el correo de restablecer puede abrir la app cuando ya estaba montada
  React.useEffect(() => { if (recuperando) setModo('nueva'); }, [recuperando]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAviso(null);
    setLoading(true);
    try {
      if (modo === 'entrar') {
        onLogin(await api.auth.login(email, password));
      } else if (modo === 'olvide') {
        if (!email) throw new Error('Escribe tu correo.');
        await api.auth.enviarRestablecimiento(email);
        setAviso('Si ese correo tiene cuenta, te llegó un enlace para crear una contraseña nueva.');
      } else {
        if (password.length < 8) throw new Error('Usa al menos 8 caracteres.');
        if (password !== password2) throw new Error('Las contraseñas no coinciden.');
        await api.auth.cambiarContrasena(password);
        const perfil = await api.auth.perfilActual();
        if (perfil) onLogin(perfil);
      }
    } catch (err: any) {
      setError(err.message || 'No se pudo completar.');
    } finally {
      setLoading(false);
    }
  };

  const titulo = modo === 'entrar' ? 'Secure Authentication'
    : modo === 'olvide' ? 'Restablecer contraseña' : 'Contraseña nueva';
  const subtitulo = modo === 'entrar' ? 'Enter your credentials to access the OS.'
    : modo === 'olvide' ? 'Te mandamos un enlace a tu correo.'
      : 'Escribe la contraseña con la que vas a entrar.';

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
            <h2 className="font-serif text-4xl mb-2 text-primary">{titulo}</h2>
            <p className="text-gray-500 text-sm font-light">{subtitulo}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {modo !== 'nueva' && (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Email Address</label>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-transparent border-b border-gray-300 py-3 text-lg focus:outline-none focus:border-primary transition-colors"
                  placeholder="name@firm.com"
                />
              </div>
            )}
            {modo !== 'olvide' && (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                  {modo === 'nueva' ? 'Contraseña nueva' : 'Password'}
                </label>
                <input
                  type="password"
                  autoComplete={modo === 'nueva' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-transparent border-b border-gray-300 py-3 text-lg focus:outline-none focus:border-primary transition-colors"
                  placeholder="••••••••"
                />
              </div>
            )}
            {modo === 'nueva' && (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Repítela</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  className="w-full bg-transparent border-b border-gray-300 py-3 text-lg focus:outline-none focus:border-primary transition-colors"
                  placeholder="••••••••"
                />
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-danger bg-red-50 border border-red-200 px-4 py-3">{error}</p>
            )}
            {aviso && (
              <p role="status" className="text-sm text-primary bg-brand-bg border border-primary/30 px-4 py-3">{aviso}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-white py-4 text-xs font-bold uppercase tracking-widest hover:bg-black transition-all shadow-xl hover:shadow-2xl disabled:opacity-50"
            >
              {loading ? '…' : modo === 'entrar' ? 'Sign In' : modo === 'olvide' ? 'Enviar enlace' : 'Guardar y entrar'}
            </button>
          </form>
          {modo !== 'nueva' && (
            <div className="mt-8 text-center">
              <button
                type="button"
                onClick={() => { setModo(modo === 'entrar' ? 'olvide' : 'entrar'); setError(null); setAviso(null); }}
                className="text-xs text-gray-400 hover:text-primary transition-colors"
              >
                {modo === 'entrar' ? 'Forgot Password?' : 'Volver a iniciar sesión'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
