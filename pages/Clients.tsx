
import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Client } from '../types';
import { Plus, User, Mail, Phone, Search, PenTool, Trash2 } from 'lucide-react';

const Clients: React.FC = () => {
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [newClient, setNewClient] = useState({ fullName: '', email: '', phone: '' });

    useEffect(() => {
        loadClients();
    }, []);

    const loadClients = async () => {
        try {
            setLoading(true);
            const data = await api.getClients();
            setClients(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const [editingClient, setEditingClient] = useState<Client | null>(null);

    const handleEdit = (client: Client) => {
        setEditingClient(client);
        setNewClient({ fullName: client.fullName, email: client.email, phone: client.phone || '' });
        setShowForm(true);
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this client?')) return;
        try {
            await api.deleteClient(id);
            await loadClients();
        } catch (e: any) {
            alert(`Error deleting client: ${e.message}`);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingClient) {
                await api.updateClient(editingClient.id, newClient);
            } else {
                await api.createClient(newClient);
            }
            await loadClients();
            setShowForm(false);
            setEditingClient(null);
            setNewClient({ fullName: '', email: '', phone: '' });
        } catch (e: any) {
            alert(`Error saving client: ${e.message}`);
        }
    };

    const handleCloseForm = () => {
        setShowForm(false);
        setEditingClient(null);
        setNewClient({ fullName: '', email: '', phone: '' });
    };

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            <div className="flex justify-between items-end border-b border-gray-200 dark:border-gray-700 pb-6">
                <div>
                    <h1 className="font-serif text-4xl dark:text-white mb-2">Clients Directory</h1>
                    <p className="text-xs font-mono uppercase tracking-widest text-gray-400">Manage your client relationships</p>
                </div>
                <button
                    onClick={() => { setShowForm(true); setEditingClient(null); setNewClient({ fullName: '', email: '', phone: '' }); }}
                    className="bg-primary dark:bg-white dark:text-gray-900 text-white px-6 py-3 text-[10px] uppercase tracking-widest font-bold hover:bg-gray-800 transition-colors flex items-center gap-2"
                >
                    <Plus size={16} /> Add Client
                </button>
            </div>

            {/* Create/Edit Form */}
            {showForm && (
                <div className="bg-white dark:bg-gray-800 p-8 border border-gray-100 dark:border-gray-700 rounded-xl max-w-2xl mx-auto shadow-lg mb-8">
                    <h3 className="font-serif text-2xl dark:text-white mb-6">{editingClient ? 'Edit Client Profile' : 'New Client Profile'}</h3>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">Full Name</label>
                            <input required type="text" className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none focus:border-primary" value={newClient.fullName} onChange={e => setNewClient({ ...newClient, fullName: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">Email Address</label>
                                <input required type="email" className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none focus:border-primary" value={newClient.email} onChange={e => setNewClient({ ...newClient, email: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">Phone Number</label>
                                <input type="tel" className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none focus:border-primary" value={newClient.phone} onChange={e => setNewClient({ ...newClient, phone: e.target.value })} />
                            </div>
                        </div>
                        <div className="flex justify-end gap-4 pt-4">
                            <button type="button" onClick={handleCloseForm} className="px-6 py-2 text-xs uppercase tracking-widest text-gray-500 hover:text-black dark:hover:text-white">Cancel</button>
                            <button type="submit" className="bg-primary text-white px-8 py-3 text-xs uppercase tracking-widest font-bold hover:bg-black transition-colors">{editingClient ? 'Update Profile' : 'Save Profile'}</button>
                        </div>
                    </form>
                </div>
            )}

            {/* Clients List */}
            {loading ? (
                <div className="text-center py-12 text-gray-400 italic">Loading directory...</div>
            ) : clients.length === 0 ? (
                <div className="text-center py-12 text-gray-400 italic">No clients found. Add your first one!</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {clients.map(client => (
                        <div key={client.id} className="relative bg-white dark:bg-gray-800 p-6 border border-gray-100 dark:border-gray-700 hover:border-primary dark:hover:border-white transition-colors group">
                            {/* Actions Overlay */}
                            <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={(e) => { e.stopPropagation(); handleEdit(client); }} className="p-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-full text-gray-600 dark:text-gray-300" title="Edit">
                                    <PenTool size={14} />
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); handleDelete(client.id); }} className="p-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50 rounded-full text-red-500" title="Delete">
                                    <Trash2 size={14} />
                                </button>
                            </div>

                            <div className="flex items-center gap-4 mb-4">
                                <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center text-primary dark:text-white font-serif text-xl">
                                    {client.fullName.charAt(0)}
                                </div>
                                <div>
                                    <h3 className="font-serif text-lg dark:text-white">{client.fullName}</h3>
                                    <span className="text-[10px] uppercase tracking-widest text-gray-400">Client</span>
                                </div>
                            </div>
                            <div className="space-y-2 border-t border-gray-50 dark:border-gray-700 pt-4">
                                <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
                                    <Mail size={14} className="text-gray-400" />
                                    {client.email}
                                </div>
                                <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
                                    <Phone size={14} className="text-gray-400" />
                                    {client.phone || 'N/A'}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default Clients;
