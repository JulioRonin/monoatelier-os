import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { User } from '../types';
import { Plus, Trash2, Edit2, User as UserIcon, Save, X, Mail } from 'lucide-react';

const UserManagement: React.FC = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
    const [guardando, setGuardando] = useState(false);

    // Form State
    const [formData, setFormData] = useState<Partial<User>>({
        fullName: '',
        email: '',
        password: '',
        role: 'Level 2'
    });

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        try {
            const data = await api.auth.getUsers();
            setUsers(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!formData.email || !formData.fullName) return;
        if (!editingUser && formData.password && formData.password.length < 8) {
            setMensaje({ tipo: 'error', texto: 'La contraseña debe tener al menos 8 caracteres.' });
            return;
        }
        setGuardando(true);
        try {
            if (editingUser) {
                await api.auth.updateUser(editingUser.id, formData);
                setMensaje({ tipo: 'ok', texto: 'Usuario actualizado.' });
            } else {
                const aviso = await api.auth.createUser({
                    email: formData.email, fullName: formData.fullName,
                    role: formData.role || 'Level 2', avatarUrl: formData.avatarUrl,
                    password: formData.password || undefined,
                });
                setMensaje({ tipo: 'ok', texto: aviso });
            }
            setIsModalOpen(false);
            setEditingUser(null);
            setFormData({ fullName: '', email: '', password: '', role: 'Level 2' });
            loadUsers();
        } catch (error: any) {
            setMensaje({ tipo: 'error', texto: error.message || 'No se pudo guardar.' });
        } finally {
            setGuardando(false);
        }
    };

    const handleDelete = async (user: User) => {
        if (!confirm(`¿Quitar el acceso de ${user.fullName}? Su cuenta deja de ver cualquier dato.`)) return;
        try {
            await api.auth.deleteUser(user.id);
            loadUsers();
        } catch (error: any) {
            setMensaje({ tipo: 'error', texto: error.message || 'No se pudo eliminar.' });
        }
    };

    const restablecer = async (user: User) => {
        try {
            await api.auth.enviarRestablecimiento(user.email);
            setMensaje({ tipo: 'ok', texto: `Se envió a ${user.email} el enlace para crear una contraseña nueva.` });
        } catch (error: any) {
            setMensaje({ tipo: 'error', texto: error.message });
        }
    };

    const openEdit = (user: User) => {
        setEditingUser(user);
        setFormData({ ...user, password: '' }); // Don't show password
        setIsModalOpen(true);
    };

    const openNew = () => {
        setEditingUser(null);
        setFormData({ fullName: '', email: '', password: '', role: 'Level 2' });
        setIsModalOpen(true);
    };

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            <div className="flex justify-between items-end border-b border-gray-200 dark:border-gray-700 pb-6">
                <div>
                    <h1 className="font-serif text-4xl dark:text-white mb-2">User Management</h1>
                    <p className="text-xs font-mono uppercase tracking-widest text-gray-400">Manage System Access & Roles</p>
                </div>
                <button onClick={openNew} className="bg-primary dark:bg-white dark:text-gray-900 text-white px-6 py-3 text-[10px] uppercase tracking-widest font-bold hover:bg-gray-800 transition-colors flex items-center gap-2">
                    <Plus size={16} /> New User
                </button>
            </div>

            {mensaje && (
                <div role={mensaje.tipo === 'error' ? 'alert' : 'status'}
                    className={`px-6 py-4 text-sm flex justify-between items-center border ${mensaje.tipo === 'error'
                        ? 'bg-red-50 border-red-200 text-danger' : 'bg-brand-bg border-primary/30 text-primary'}`}>
                    <span>{mensaje.texto}</span>
                    <button onClick={() => setMensaje(null)} aria-label="Cerrar"><X size={16} /></button>
                </div>
            )}

            {/* User List */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-gray-50 dark:bg-gray-900/50 text-[10px] uppercase tracking-widest text-gray-500 border-b border-gray-100 dark:border-gray-700">
                            <th className="p-6 font-bold">User</th>
                            <th className="p-6 font-bold">Role</th>
                            <th className="p-6 font-bold">Email</th>
                            <th className="p-6 font-bold">Cuenta</th>
                            <th className="p-6 font-bold text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {users.map(user => (
                            <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group">
                                <td className="p-6">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-400">
                                            {user.avatarUrl ? <img src={user.avatarUrl} className="w-full h-full rounded-full object-cover" /> : <UserIcon size={20} />}
                                        </div>
                                        <span className="font-bold text-sm dark:text-white">{user.fullName}</span>
                                    </div>
                                </td>
                                <td className="p-6">
                                    <span className={`text-[10px] uppercase tracking-widest font-bold px-3 py-1 rounded-full ${user.role === 'Super User' ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-500'}`}>
                                        {user.role}
                                    </span>
                                </td>
                                <td className="p-6 text-sm text-gray-500 font-mono">{user.email}</td>
                                <td className="p-6 text-[11px] text-gray-500">
                                    {user.authId ? 'Activa' : 'Aún no entra'}
                                </td>
                                <td className="p-6 text-right space-x-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                    <button onClick={() => restablecer(user)} title="Enviar correo para restablecer contraseña" className="text-gray-400 hover:text-primary transition-colors"><Mail size={16} /></button>
                                    <button onClick={() => openEdit(user)} title="Editar" className="text-gray-400 hover:text-primary transition-colors"><Edit2 size={16} /></button>
                                    <button onClick={() => handleDelete(user)} title="Quitar acceso" className="text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-xl shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900">
                            <h3 className="font-serif text-xl dark:text-white">{editingUser ? 'Edit User' : 'Add New User'}</h3>
                            <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-900 dark:hover:text-white"><X size={20} /></button>
                        </div>
                        <div className="p-8 space-y-6">
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">Full Name</label>
                                <input type="text" className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none focus:border-primary transition-colors"
                                    value={formData.fullName} onChange={e => setFormData({ ...formData, fullName: e.target.value })} placeholder="Ex. John Doe" />
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">Email Address</label>
                                <input type="email" disabled={!!editingUser} className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none focus:border-primary transition-colors disabled:opacity-60"
                                    value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="name@firm.com" />
                                {editingUser && (
                                    <p className="text-[11px] text-gray-400 mt-1">El correo liga el perfil con su cuenta: para cambiarlo, crea otro usuario.</p>
                                )}
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">Role</label>
                                <select className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none focus:border-primary transition-colors"
                                    value={formData.role} onChange={(e: any) => setFormData({ ...formData, role: e.target.value })}>
                                    <option value="Level 2">Level 2 (Standard)</option>
                                    <option value="Super User">Super User (Admin)</option>
                                </select>
                            </div>
                            {editingUser ? (
                                <p className="text-[11px] text-gray-500">
                                    Las contraseñas las guarda Supabase y nadie más las ve. Para cambiar la
                                    de esta persona, usa el sobre <Mail size={11} className="inline" /> en la
                                    lista: le llega un enlace para crear una nueva.
                                </p>
                            ) : (
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">Contraseña inicial</label>
                                    <input type="password" autoComplete="new-password" className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none focus:border-primary transition-colors"
                                        value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} placeholder="mínimo 8 caracteres" />
                                    <p className="text-[11px] text-gray-400 mt-1">Le llega un correo para confirmar su cuenta antes de entrar.</p>
                                </div>
                            )}
                        </div>
                        <div className="p-6 border-t border-gray-100 dark:border-gray-700 flex justify-end gap-3 bg-gray-50 dark:bg-gray-900">
                            <button onClick={() => setIsModalOpen(false)} className="px-6 py-2 text-[10px] uppercase tracking-widest font-bold text-gray-500 hover:text-gray-900">Cancel</button>
                            <button onClick={handleSave} disabled={guardando} className="disabled:opacity-50 bg-primary hover:bg-gray-900 text-white px-6 py-2 text-[10px] uppercase tracking-widest font-bold transition-colors flex items-center gap-2">
                                <Save size={14} /> Save User
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserManagement;
