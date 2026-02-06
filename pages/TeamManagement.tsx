import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { TeamMember, TeamCategory, PermissionLevel } from '../types';
import {
    Users,
    Plus,
    Search,
    Filter,
    MoreVertical,
    Shield,
    Briefcase,
    Mail,
    Trash2,
    Edit2,
    CheckCircle,
    XCircle
} from 'lucide-react';

const TeamManagement: React.FC = () => {
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterCategory, setFilterCategory] = useState<string>('All');
    const [searchQuery, setSearchQuery] = useState('');

    // Modal State
    const [showModal, setShowModal] = useState(false);
    const [editingMember, setEditingMember] = useState<TeamMember | null>(null);

    // Form State
    const [formData, setFormData] = useState<Partial<TeamMember>>({
        fullName: '',
        email: '',
        role: '',
        category: 'Technical',
        permissionLevel: 'Lvl 1',
        status: 'Active'
    });

    useEffect(() => {
        loadTeam();
    }, []);

    const loadTeam = async () => {
        try {
            setLoading(true);
            const data = await api.getTeamMembers();
            setMembers(data);
        } catch (e) {
            console.error("Failed to load team", e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            if (editingMember) {
                // Update
                await api.updateTeamMember(editingMember.id, formData);
                // alert("Update Saved: " + formData.fullName);
            } else {
                // Create
                await api.addTeamMember(formData);
                // alert("Member Created: " + formData.fullName);
            }
            setShowModal(false);
            loadTeam(); // Reload
        } catch (e) {
            console.error(e);
            alert("Failed to save. Check console for details.");
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm("Are you sure you want to remove this member?")) {
            try {
                await api.deleteTeamMember(id);
                loadTeam();
            } catch (e) {
                console.error(e);
                alert("Failed to delete.");
            }
        }
    };

    const openModal = (member?: TeamMember) => {
        if (member) {
            setEditingMember(member);
            setFormData(member);
        } else {
            setEditingMember(null);
            setFormData({
                fullName: '',
                email: '',
                role: '',
                category: 'Technical',
                permissionLevel: 'Lvl 1',
                status: 'Active'
            });
        }
        setShowModal(true);
    };

    const filteredMembers = members.filter(m => {
        const matchesCategory = filterCategory === 'All' || m.category === filterCategory;
        const searchLower = searchQuery.toLowerCase();
        const nameMatch = m.fullName ? m.fullName.toLowerCase().includes(searchLower) : false;
        const roleMatch = m.role ? m.role.toLowerCase().includes(searchLower) : false;

        return matchesCategory && (nameMatch || roleMatch);
    });

    const getPermissionColor = (level: string) => {
        switch (level) {
            case 'Super User': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300';
            case 'Lvl 3': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
            case 'Lvl 2': return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
            default: return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400';
        }
    };

    return (
        <div className="p-8 space-y-8 animate-fade-in custom-scrollbar h-full overflow-y-auto">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="font-serif text-3xl dark:text-white mb-2">Team Management</h1>
                    <p className="text-gray-400 text-sm">Manage roles, permissions, and access levels.</p>
                </div>
                <button
                    onClick={() => openModal()}
                    className="flex items-center gap-2 bg-primary text-white dark:bg-white dark:text-primary px-6 py-3 text-xs uppercase tracking-widest hover:bg-gray-800 transition-colors"
                >
                    <Plus size={16} /> Add Member
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800 p-6 border border-gray-100 dark:border-gray-700 flex items-center gap-4">
                    <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-full">
                        <Users size={20} className="text-gray-500 dark:text-white" />
                    </div>
                    <div>
                        <p className="text-2xl font-bold dark:text-white">{members.length}</p>
                        <p className="text-[10px] uppercase tracking-widest text-gray-400">Total Members</p>
                    </div>
                </div>
                {/* Add more stats if needed */}
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4 items-center bg-white dark:bg-gray-800 p-4 border border-gray-100 dark:border-gray-700">
                <div className="flex items-center gap-2 flex-1 w-full bg-gray-50 dark:bg-gray-900 px-4 py-2 rounded">
                    <Search size={16} className="text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search members..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-transparent w-full text-sm focus:outline-none dark:text-white"
                    />
                </div>
                <div className="flex gap-2 overflow-x-auto w-full md:w-auto">
                    {['All', 'Project Manager', 'Coordinator', 'Leader', 'Technical'].map(cat => (
                        <button
                            key={cat}
                            onClick={() => setFilterCategory(cat)}
                            className={`px-4 py-2 text-xs uppercase tracking-widest whitespace-nowrap transition-colors border ${filterCategory === cat ? 'bg-black text-white dark:bg-white dark:text-black border-black dark:border-white' : 'bg-transparent text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-400'}`}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {loading ? (
                    <div className="col-span-full py-12 text-center text-gray-400">Loading team...</div>
                ) : filteredMembers.map(member => (
                    <div key={member.id} className="group bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-6 hover:shadow-lg transition-all relative">
                        <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                            <button onClick={() => openModal(member)} className="p-2 text-gray-400 hover:text-primary dark:hover:text-white"><Edit2 size={14} /></button>
                            <button onClick={() => handleDelete(member.id)} className="p-2 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                        </div>

                        <div className="flex flex-col items-center text-center mb-6">
                            <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-700 mb-4 overflow-hidden">
                                {member.avatarUrl ? (
                                    <img src={member.avatarUrl} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-xl font-bold text-gray-400">
                                        {member.fullName.substring(0, 2).toUpperCase()}
                                    </div>
                                )}
                            </div>
                            <h3 className="font-serif text-lg dark:text-white mb-1">{member.fullName}</h3>
                            <p className="text-xs text-gray-400 uppercase tracking-widest mb-3">{member.role}</p>

                            <div className="flex gap-2 flex-wrap justify-center">
                                <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${getPermissionColor(member.permissionLevel)}`}>
                                    {member.permissionLevel}
                                </span>
                                <span className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300">
                                    {member.category}
                                </span>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-gray-100 dark:border-gray-700 space-y-2">
                            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                                <Mail size={14} />
                                <span className="truncate">{member.email || 'No email'}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                                <div className={`w-2 h-2 rounded-full ${member.status === 'Active' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                                <span>{member.status}</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-gray-800 p-8 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto border border-gray-100 dark:border-gray-700">
                        <h2 className="font-serif text-2xl dark:text-white mb-6">{editingMember ? 'Edit Member' : 'Add New Member'}</h2>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Full Name</label>
                                <input
                                    type="text"
                                    value={formData.fullName}
                                    onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                                    className="w-full bg-surface dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none dark:text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Email</label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                                    className="w-full bg-surface dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none dark:text-white"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Role Title</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Senior Architect"
                                        value={formData.role}
                                        onChange={e => setFormData({ ...formData, role: e.target.value })}
                                        className="w-full bg-surface dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Status</label>
                                    <select
                                        value={formData.status}
                                        onChange={e => setFormData({ ...formData, status: e.target.value as any })}
                                        className="w-full bg-surface dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none dark:text-white"
                                    >
                                        <option value="Active">Active</option>
                                        <option value="Inactive">Inactive</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Category</label>
                                    <select
                                        value={formData.category}
                                        onChange={e => setFormData({ ...formData, category: e.target.value as any })}
                                        className="w-full bg-surface dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none dark:text-white"
                                    >
                                        <option value="Project Manager">Project Manager</option>
                                        <option value="Coordinator">Coordinator</option>
                                        <option value="Leader">Leader</option>
                                        <option value="Technical">Technical</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Permission Level</label>
                                    <select
                                        value={formData.permissionLevel}
                                        onChange={e => setFormData({ ...formData, permissionLevel: e.target.value as any })}
                                        className="w-full bg-surface dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none dark:text-white"
                                    >
                                        <option value="Lvl 1">Lvl 1 (Basic)</option>
                                        <option value="Lvl 2">Lvl 2 (Standard)</option>
                                        <option value="Lvl 3">Lvl 3 (Manager)</option>
                                        <option value="Super User">Super User</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-4 mt-8">
                            <button
                                onClick={() => setShowModal(false)}
                                className="flex-1 py-3 border border-gray-200 dark:border-gray-600 text-xs uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                className="flex-1 bg-primary text-white dark:bg-white dark:text-primary py-3 text-xs uppercase tracking-widest hover:opacity-90 transition-opacity"
                            >
                                Save Member
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TeamManagement;
