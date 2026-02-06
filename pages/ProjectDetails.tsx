import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Project, Client, ProjectStatus, PhaseEnum, TeamMember, User } from '../types';
import { ArrowLeft, Calendar, DollarSign, Upload, Save, MapPin, User as UserIcon, Users, CheckCircle, Trash2, Edit2, X } from 'lucide-react';

interface ProjectDetailsProps {
    projectId: string;
    onBack: () => void;
    user?: any; // strict: User | null
}

const ProjectDetails: React.FC<ProjectDetailsProps> = ({ projectId, onBack, user }) => {
    const [project, setProject] = useState<Project | null>(null);
    const [client, setClient] = useState<Client | null>(null);
    const [loading, setLoading] = useState(true);

    // Local state for editing
    const [status, setStatus] = useState<ProjectStatus>(ProjectStatus.In_Progress);
    const [phase, setPhase] = useState<PhaseEnum>(PhaseEnum.Design_Review);
    const [budget, setBudget] = useState(0);
    const [liveCost, setLiveCost] = useState(0);
    const [startDate, setStartDate] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [progress, setProgress] = useState(0);
    const [responsibleId, setResponsibleId] = useState<string | undefined>(undefined);

    // Payments State
    const [payments, setPayments] = useState<any[]>([]);
    const [showPaymentForm, setShowPaymentForm] = useState(false);
    const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);

    // Gallery State
    const [gallery, setGallery] = useState<string[]>([]);
    // ... (I will do this in multiple replacements for safety)


    const [clients, setClients] = useState<Client[]>([]);
    const [allTeamMembers, setAllTeamMembers] = useState<TeamMember[]>([]);
    const [users, setUsers] = useState<User[]>([]); // System Users for "Responsible" field
    const [showTeamModal, setShowTeamModal] = useState(false);

    useEffect(() => {
        loadProjectData();
    }, [projectId]);

    const loadProjectData = async () => {
        try {
            setLoading(true);
            const [projectData, clientsData, paymentsData, teamData, userData] = await Promise.all([
                api.getProjectById(projectId),
                api.getClients(),
                api.getPayments(projectId),
                api.getTeamMembers(),
                api.auth.getUsers()
            ]);

            setProject(projectData);
            setClients(clientsData);
            setPayments(paymentsData);
            setAllTeamMembers(teamData);
            setUsers(userData);

            // Initialize local state
            setStatus(projectData.status);
            setPhase(projectData.phase);
            setBudget(projectData.budget);
            setLiveCost(projectData.liveCost);
            setStartDate(projectData.startDate || '');
            setDueDate(projectData.dueDate || '');
            setDueDate(projectData.dueDate || '');
            setProgress(projectData.progress);
            setResponsibleId(projectData.responsibleId);
            setGallery(projectData.docsUrl || []);

            // Fetch Client if exists
            if (projectData.clientId) {
                const found = clientsData.find((c: Client) => c.id === projectData.clientId);
                setClient(found || null);
            }
        } catch (e) {
            console.error("Failed to load project", e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!project) return;
        try {
            await api.updateProject(projectId, {
                status,
                phase,
                budget,
                liveCost,
                startDate,
                dueDate,
                progress,
                responsibleId,
                clientId: client?.id // Allow saving the client change
            });
            alert("Project details updated successfully!");
        } catch (e: any) {
            console.error("Error saving project:", e);
            alert(`Failed to save changes: ${e.message}`);
        }
    };

    const handleUpload = async () => {
        const url = prompt("Enter image URL:");
        if (url && project) {
            const newGallery = [...gallery, url];
            setGallery(newGallery);
            try {
                await api.updateProject(projectId, { docsUrl: newGallery });
            } catch (e) {
                console.error("Failed to save image", e);
                alert("Failed to save image.");
            }
        }
    };

    const handleDeleteImage = async (index: number) => {
        if (!confirm("Are you sure you want to delete this photo?")) return;
        if (project) {
            const newGallery = gallery.filter((_, i) => i !== index);
            setGallery(newGallery);
            try {
                await api.updateProject(projectId, { docsUrl: newGallery });
            } catch (e) {
                console.error("Failed to delete image", e);
                alert("Failed to delete image.");
            }
        }
    };

    const handleCancelProject = async () => {
        if (!confirm("Are you sure you want to CANCEL this project?\nThis will mark it as Cancelled but not delete it.")) return;

        try {
            await api.updateProject(projectId, { status: ProjectStatus.Cancelled });
            setStatus(ProjectStatus.Cancelled);
            alert("Project has been cancelled.");
            onBack();
        } catch (e: any) {
            alert(`Error cancelling project: ${e.message}`);
        }
    };

    if (loading) return <div className="p-12 text-center text-gray-400 animate-pulse">Loading project details...</div>;
    if (!project) return <div className="p-12 text-center text-red-400">Project not found</div>;

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            {/* Header / Nav */}
            <div className="flex items-center gap-4 mb-8">
                <button
                    onClick={onBack}
                    className="p-2 border border-gray-200 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-800 transition-colors text-gray-500 dark:text-gray-400"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <p className="text-[10px] uppercase tracking-widest text-gray-400">Project Management / Details</p>
                </div>
                <div className="ml-auto flex gap-4">
                    <button
                        onClick={handleCancelProject}
                        className="flex items-center gap-2 border border-red-200 text-red-500 dark:border-red-900/50 dark:text-red-400 bg-red-50 dark:bg-red-900/10 px-6 py-3 text-xs uppercase tracking-widest hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                    >
                        <Trash2 size={16} />
                        Cancel Project
                    </button>
                    <button
                        onClick={handleSave}
                        className="flex items-center gap-2 bg-primary text-white dark:bg-white dark:text-primary px-6 py-3 text-xs uppercase tracking-widest hover:bg-gray-800 transition-colors"
                    >
                        <Save size={16} />
                        Save Changes
                    </button>
                </div>
            </div>

            {/* Team Update Handler */}
            {/* Modal Logic Helper */}
            {/* Note: Defined here to be safely inside scope */}


            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Main Info Column */}
                <div className="lg:col-span-2 space-y-8">
                    {/* Title & Status */}
                    <div className="bg-white dark:bg-gray-800 p-8 border border-gray-100 dark:border-gray-700">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                            <div>
                                <h1 className="font-serif text-4xl md:text-5xl dark:text-white mb-2">{project.name}</h1>
                                <div className="flex items-center gap-2 text-gray-400">
                                    <MapPin size={14} />
                                    <span className="text-xs uppercase tracking-widest">Mexico City, MX</span>
                                </div>
                            </div>
                            <div className="flex flex-col gap-2 min-w-[200px]">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Current Status</label>
                                <select
                                    value={status}
                                    onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                                    className="bg-surface dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm dark:text-white focus:outline-none"
                                >
                                    {Object.values(ProjectStatus).map(s => (
                                        <option key={s} value={s}>{s.replace('_', ' ')}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 mb-8">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Responsible User (Manager)</label>
                            {user?.role === 'Super User' ? (
                                <select
                                    value={responsibleId || ''}
                                    onChange={(e) => setResponsibleId(e.target.value || undefined)}
                                    className="w-full bg-surface dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-4 py-3 text-sm dark:text-white focus:outline-none rounded-lg"
                                >
                                    <option value="">-- Unassigned --</option>
                                    {users.map(u => (
                                        <option key={u.id} value={u.id}>{u.fullName} ({u.role})</option>
                                    ))}
                                </select>
                            ) : (
                                <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 text-sm font-medium dark:text-gray-300">
                                    {responsibleId && users.find(u => u.id === responsibleId)?.fullName || 'Unassigned'}
                                    <span className="ml-2 text-xs text-gray-400 font-normal italic">
                                        (Contact Super User to reassign)
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="w-full bg-gray-100 dark:bg-gray-700 h-1 mb-8 mt-8">
                            <div className="bg-secondary h-1 transition-all duration-500" style={{ width: `${progress}%` }}></div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Phase</label>
                                <select
                                    value={phase}
                                    onChange={(e) => setPhase(e.target.value as PhaseEnum)}
                                    className="w-full bg-transparent border-b border-gray-200 dark:border-gray-600 py-2 font-serif text-xl italic dark:text-white focus:outline-none"
                                >
                                    {Object.values(PhaseEnum).map(p => (
                                        <option key={p} value={p}>{p}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Completion %</label>
                                <div className="flex items-center gap-4">
                                    <input
                                        type="range"
                                        min="0" max="100"
                                        value={progress}
                                        onChange={(e) => setProgress(parseInt(e.target.value))}
                                        className="flex-1 h-[2px] bg-gray-200 rounded-lg appearance-none cursor-pointer"
                                    />
                                    <span className="font-mono text-lg dark:text-white">{progress}%</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Financial Overview & Payments */}
                    <div className="bg-white dark:bg-gray-800 p-8 border border-gray-100 dark:border-gray-700 animate-fade-in">
                        <h3 className="font-serif text-2xl dark:text-white mb-6">Financial Overview</h3>

                        {/* Summary Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                            <div className="p-6 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-800">
                                <div className="flex items-center gap-2 mb-2 text-gray-400">
                                    <DollarSign size={14} />
                                    <span className="text-[10px] uppercase tracking-widest font-bold">Total Budget</span>
                                </div>
                                <input
                                    type="number"
                                    value={budget}
                                    onChange={(e) => setBudget(parseFloat(e.target.value))}
                                    className="w-full bg-transparent text-2xl font-mono font-bold text-primary dark:text-white focus:outline-none border-b border-transparent focus:border-gray-300"
                                />
                            </div>
                            <div className="p-6 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-800">
                                <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-bold">$ Total Paid</p>
                                <p className="font-mono text-2xl font-bold text-green-600">
                                    ${payments.reduce((sum, p) => sum + p.amount, 0).toLocaleString()}
                                </p>
                            </div>
                            <div className="p-6 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-100 dark:border-gray-800">
                                <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-2 font-bold">$ Remaining Balance</p>
                                <p className="font-mono text-2xl font-bold text-primary dark:text-gray-300">
                                    ${(budget - payments.reduce((sum, p) => sum + p.amount, 0)).toLocaleString()}
                                </p>
                            </div>
                        </div>

                        {/* Live Cost Input (Moved here) */}
                        <div className="mb-8 p-6 bg-surface dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg">
                            <div className="flex items-center gap-2 mb-2 text-gray-400">
                                <span className="text-[10px] uppercase tracking-widest font-bold">Internal Live Cost (Expenses)</span>
                            </div>
                            <input
                                type="number"
                                value={liveCost}
                                onChange={(e) => setLiveCost(parseFloat(e.target.value))}
                                className={`w-full bg-transparent text-2xl font-mono focus:outline-none border-b border-transparent focus:border-gray-300 ${liveCost > budget ? 'text-danger' : 'text-primary dark:text-white'}`}
                            />
                        </div>

                        {/* Payments List & Form */}
                        <div className="border-t border-gray-100 dark:border-gray-700 pt-8">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <h4 className="font-serif text-xl dark:text-white">Payments History</h4>
                                    <p className="text-[10px] text-gray-400 uppercase tracking-widest">Client Transactions</p>
                                </div>
                                <button
                                    onClick={() => {
                                        setShowPaymentForm(!showPaymentForm);
                                        setEditingPaymentId(null); // Reset edit on toggle
                                    }}
                                    className="text-xs uppercase tracking-widest font-bold border-b border-black dark:border-white pb-1 hover:opacity-50 transition-opacity dark:text-white"
                                >
                                    {showPaymentForm ? 'Cancel' : '+ Record Payment'}
                                </button>
                            </div>

                            {showPaymentForm && (
                                <div className="mb-8 p-6 bg-gray-50 dark:bg-gray-900/50 rounded border border-gray-100 dark:border-gray-700 animate-fade-in">
                                    <h5 className="font-bold text-sm mb-4 dark:text-white">{editingPaymentId ? 'Edit Transaction' : 'New Transaction'}</h5>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                        <div>
                                            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Amount</label>
                                            <input
                                                type="number"
                                                placeholder="0"
                                                className="w-full bg-white dark:bg-gray-800 border-none p-3 font-mono text-sm focus:ring-1 focus:ring-primary dark:text-white"
                                                id="paymentAmount"
                                                defaultValue={editingPaymentId ? payments.find(p => p.id === editingPaymentId)?.amount : ''}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Date</label>
                                            <input
                                                type="date"
                                                defaultValue={editingPaymentId ? payments.find(p => p.id === editingPaymentId)?.date : new Date().toISOString().split('T')[0]}
                                                className="w-full bg-white dark:bg-gray-800 border-none p-3 font-mono text-sm focus:ring-1 focus:ring-primary dark:text-white"
                                                id="paymentDate"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Method</label>
                                            <select
                                                className="w-full bg-white dark:bg-gray-800 border-none p-3 font-mono text-sm focus:ring-1 focus:ring-primary dark:text-white"
                                                id="paymentMethod"
                                                defaultValue={editingPaymentId ? payments.find(p => p.id === editingPaymentId)?.method : 'Transfer'}
                                            >
                                                <option value="Transfer">Transfer</option>
                                                <option value="Cash">Cash</option>
                                                <option value="Card">Card</option>
                                                <option value="Check">Check</option>
                                                <option value="Other">Other</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Notes</label>
                                            <input
                                                type="text"
                                                placeholder="Reference #, etc."
                                                className="w-full bg-white dark:bg-gray-800 border-none p-3 font-mono text-sm focus:ring-1 focus:ring-primary dark:text-white"
                                                id="paymentNotes"
                                                defaultValue={editingPaymentId ? payments.find(p => p.id === editingPaymentId)?.notes : ''}
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            const amountInput = document.getElementById('paymentAmount') as HTMLInputElement;
                                            const dateInput = document.getElementById('paymentDate') as HTMLInputElement;
                                            const methodInput = document.getElementById('paymentMethod') as HTMLSelectElement;
                                            const notesInput = document.getElementById('paymentNotes') as HTMLInputElement;

                                            const amount = parseFloat(amountInput.value);
                                            const date = dateInput.value;
                                            const method = methodInput.value;
                                            const notes = notesInput.value;

                                            if (amount > 0) {
                                                try {
                                                    if (editingPaymentId) {
                                                        // Update
                                                        await api.updatePayment(editingPaymentId, { amount, date, method, notes });
                                                        alert("Payment updated successfully");
                                                    } else {
                                                        // Create
                                                        await api.addPayment({ projectId: project.id, amount, date, method, notes });
                                                    }

                                                    // Reload payments
                                                    const updatedPayments = await api.getPayments(project.id);
                                                    setPayments(updatedPayments);
                                                    setShowPaymentForm(false);
                                                    setEditingPaymentId(null);
                                                    amountInput.value = '';
                                                    notesInput.value = '';
                                                } catch (e: any) {
                                                    alert(`Failed to save payment: ${e.message}`);
                                                    console.error(e);
                                                }
                                            } else {
                                                alert("Please enter a valid amount");
                                            }
                                        }}
                                        className="bg-black text-white px-6 py-2 text-xs uppercase tracking-widest hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
                                    >
                                        {editingPaymentId ? 'Update Transaction' : 'Save Transaction'}
                                    </button>
                                </div>
                            )}

                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="border-b border-gray-100 dark:border-gray-700">
                                            <th className="pb-3 text-[10px] uppercase tracking-widest text-gray-400 font-normal">Date</th>
                                            <th className="pb-3 text-[10px] uppercase tracking-widest text-gray-400 font-normal">Method</th>
                                            <th className="pb-3 text-[10px] uppercase tracking-widest text-gray-400 font-normal">Notes</th>
                                            <th className="pb-3 text-[10px] uppercase tracking-widest text-gray-400 font-normal text-right">Amount</th>
                                            <th className="pb-3 text-[10px] uppercase tracking-widest text-gray-400 font-normal text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {payments.length === 0 ? (
                                            <tr>
                                                <td colSpan={4} className="py-6 text-center text-gray-400 text-sm italic">No payments recorded yet.</td>
                                            </tr>
                                        ) : (
                                            payments.map((p, i) => (
                                                <tr key={i} className="border-b border-gray-50 dark:border-gray-800 last:border-none hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors">
                                                    <td className="py-4 font-mono text-xs text-gray-600 dark:text-gray-300">{p.date}</td>
                                                    <td className="py-4 font-mono text-xs text-gray-600 dark:text-gray-300">{p.method}</td>
                                                    <td className="py-4 text-xs get-gray-600 dark:text-gray-400 italic">{p.notes || '-'}</td>
                                                    <td className="py-4 font-mono text-xs font-bold text-right dark:text-white">${p.amount.toLocaleString()}</td>
                                                    <td className="py-4 text-right">
                                                        <div className="flex items-center justify-end gap-2 text-gray-400">
                                                            <button
                                                                onClick={() => {
                                                                    setEditingPaymentId(p.id);
                                                                    setShowPaymentForm(true);
                                                                }}
                                                                className="hover:text-primary dark:hover:text-white p-1"
                                                                title="Edit"
                                                            >
                                                                <Edit2 size={14} />
                                                            </button>
                                                            <button
                                                                onClick={async () => {
                                                                    if (confirm('Are you sure you want to delete this payment? This cannot be undone.')) {
                                                                        try {
                                                                            await api.deletePayment(p.id);
                                                                            setPayments(payments.filter(pay => pay.id !== p.id));
                                                                        } catch (e: any) {
                                                                            alert(`Failed to delete payment: ${e.message}`);
                                                                        }
                                                                    }
                                                                }}
                                                                className="hover:text-red-500 p-1"
                                                                title="Delete"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Sidebar Column */}
                <div className="space-y-8">
                    {/* Dates */}
                    <div className="bg-white dark:bg-gray-800 p-8 border border-gray-100 dark:border-gray-700">
                        <h3 className="font-serif text-xl italic dark:text-white mb-6">Timeline</h3>
                        <div className="space-y-6">
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Start Date</label>
                                <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
                                    <Calendar size={16} className="text-gray-400" />
                                    <input
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="w-full bg-transparent text-sm dark:text-white focus:outline-none"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Due Date</label>
                                <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
                                    <Calendar size={16} className="text-gray-400" />
                                    <input
                                        type="date"
                                        value={dueDate}
                                        onChange={(e) => setDueDate(e.target.value)}
                                        className="w-full bg-transparent text-sm dark:text-white focus:outline-none"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Client Info (Editable) */}
                    <div className="bg-white dark:bg-gray-800 p-8 border border-gray-100 dark:border-gray-700">
                        <h3 className="font-serif text-xl italic dark:text-white mb-6">Client Details</h3>
                        <div className="flex items-center gap-4 mb-4">
                            {client?.avatarUrl ? (
                                <img src={client.avatarUrl} alt="Client" className="w-12 h-12 rounded-full object-cover" />
                            ) : (
                                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 font-bold">
                                    {client?.fullName ? client.fullName.substring(0, 2).toUpperCase() : '?'}
                                </div>
                            )}
                            <div className="flex-1">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Assigned Client</label>
                                <select
                                    className="w-full bg-transparent border-b border-gray-200 dark:border-gray-700 font-bold text-sm dark:text-white focus:outline-none mt-1"
                                    value={client?.id || ''}
                                    onChange={(e) => setClient(clients.find(c => c.id === e.target.value) || null)}
                                >
                                    <option value="" disabled>Select Client...</option>
                                    {clients.map(c => (
                                        <option key={c.id} value={c.id}>{c.fullName}</option>
                                    ))}
                                </select>
                                <p className="text-xs text-gray-400 mt-1">{client?.email}</p>
                            </div>
                        </div>
                        <button className="w-full border border-gray-200 dark:border-gray-600 text-xs uppercase tracking-widest py-3 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors dark:text-gray-300">
                            View Profile
                        </button>
                    </div>

                    {/* Assigned Team (Functional) */}
                    <div className="bg-white dark:bg-gray-800 p-8 border border-gray-100 dark:border-gray-700">
                        <h3 className="font-serif text-xl italic dark:text-white mb-6">Assigned Team</h3>

                        <div className="flex -space-x-3 mb-6 pl-2">
                            {project.team && project.team.length > 0 ? (
                                project.team.map((memberId, i) => {
                                    const member = allTeamMembers.find(m => m.id === memberId);
                                    if (!member) return null;
                                    return (
                                        <div key={memberId} className="relative group cursor-help">
                                            {member.avatarUrl ? (
                                                <img
                                                    src={member.avatarUrl}
                                                    alt={member.fullName}
                                                    title={`${member.fullName} - ${member.role}`}
                                                    className="w-10 h-10 rounded-full border-2 border-white dark:border-gray-800 object-cover"
                                                />
                                            ) : (
                                                <div className="w-10 h-10 rounded-full border-2 border-white dark:border-gray-800 bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-500 dark:text-gray-300" title={member.fullName}>
                                                    {member.fullName.substring(0, 2).toUpperCase()}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            ) : (
                                <p className="text-sm text-gray-400 italic py-2">No team members assigned.</p>
                            )}
                        </div>

                        <button
                            onClick={() => setShowTeamModal(true)}
                            className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-gray-500 hover:text-primary dark:text-gray-400 dark:hover:text-white transition-colors"
                        >
                            <Users size={14} />
                            Manage Team
                        </button>
                    </div>
                </div>
            </div>

            {/* Manage Team Modal */}
            {
                showTeamModal && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm animate-fade-in">
                        <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-md m-4 border border-gray-100 dark:border-gray-700">
                            <h3 className="font-serif text-2xl dark:text-white mb-2">Manage Team</h3>
                            <p className="text-xs text-gray-500 uppercase tracking-widest mb-6">Select members for {project.name}</p>

                            <div className="max-h-[300px] overflow-y-auto space-y-2 mb-6 custom-scrollbar pr-2">
                                {allTeamMembers.map(member => {
                                    const isSelected = project.team.includes(member.id);
                                    return (
                                        <div
                                            key={member.id}
                                            onClick={() => {
                                                const newTeam = isSelected
                                                    ? project.team.filter(id => id !== member.id)
                                                    : [...project.team, member.id];
                                                setProject({ ...project, team: newTeam });
                                            }}
                                            className={`flex items-center gap-4 p-3 rounded-lg cursor-pointer border transition-all ${isSelected ? 'border-primary bg-primary/5 dark:border-white dark:bg-white/10' : 'border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
                                        >
                                            <div className={`w-5 h-5 rounded border flex items-center justify-center ${isSelected ? 'bg-primary border-primary dark:bg-white dark:border-white' : 'border-gray-300'}`}>
                                                {isSelected && <CheckCircle size={12} className="text-white dark:text-black" />}
                                            </div>

                                            {member.avatarUrl ? (
                                                <img src={member.avatarUrl} className="w-8 h-8 rounded-full object-cover" />
                                            ) : (
                                                <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-[10px] font-bold">
                                                    {member.fullName.substring(0, 2).toUpperCase()}
                                                </div>
                                            )}

                                            <div>
                                                <p className="font-bold text-sm dark:text-white">{member.fullName}</p>
                                                <p className="text-[10px] text-gray-400 uppercase tracking-wider">{member.role}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Notification Option */}
                            <div className="flex items-center gap-2 mb-6">
                                <input
                                    type="checkbox"
                                    id="notifyMembers"
                                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    defaultChecked
                                />
                                <label htmlFor="notifyMembers" className="text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
                                    Send email notification to new members
                                </label>
                            </div>

                            <div className="flex gap-4">
                                <button
                                    onClick={() => setShowTeamModal(false)}
                                    className="flex-1 py-3 border border-gray-200 dark:border-gray-600 text-xs uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={async () => {
                                        const notify = (document.getElementById('notifyMembers') as HTMLInputElement).checked;
                                        try {
                                            // 1. Get original state to calc updates
                                            const original = await api.getProjectById(project.id);
                                            const originalTeam = original.team || [];
                                            const newTeam = project.team;

                                            // 2. Save
                                            await api.updateProject(project.id, { team: newTeam });

                                            // 3. Notify Logic
                                            if (notify) {
                                                const addedIds = newTeam.filter(id => !originalTeam.includes(id));
                                                if (addedIds.length > 0) {
                                                    const addedNames = allTeamMembers
                                                        .filter(m => addedIds.includes(m.id))
                                                        .map(m => m.fullName)
                                                        .join(', ');
                                                    alert(`Team updated! Notifications sent to new members: ${addedNames}`);
                                                } else {
                                                    alert("Team updated. No new members to notify.");
                                                }
                                            } else {
                                                alert("Team updated successfully.");
                                            }
                                            setShowTeamModal(false);
                                        } catch (e) {
                                            console.error("Failed to update team", e);
                                            alert("Failed to save team assignments");
                                        }
                                    }}
                                    className="flex-1 bg-primary text-white dark:bg-white dark:text-primary py-3 text-xs uppercase tracking-widest hover:opacity-90 transition-opacity"
                                >
                                    Save Changes
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Gallery / Updates Section */}
            <div className="bg-white dark:bg-gray-800 p-8 border border-gray-100 dark:border-gray-700">
                <div className="flex justify-between items-end mb-8">
                    <div>
                        <h3 className="font-serif text-3xl dark:text-white mb-2">Visual Updates</h3>
                        <p className="text-xs text-gray-400 font-mono">SITE PROGRESS LOG</p>
                    </div>
                    <p className="text-[10px] uppercase tracking-widest text-gray-400">{gallery.length} Images Uploaded</p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {/* Upload Button */}
                    <button
                        onClick={handleUpload}
                        className="aspect-square border-2 border-dashed border-gray-200 dark:border-gray-600 flex flex-col items-center justify-center gap-4 hover:border-primary dark:hover:border-white hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all group"
                    >
                        <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center group-hover:bg-white dark:group-hover:bg-gray-600 transition-colors">
                            <Upload size={20} className="text-gray-400 group-hover:text-primary dark:text-gray-300 dark:group-hover:text-white" />
                        </div>
                        <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">Upload Photo</span>
                    </button>

                    {/* Images */}
                    {gallery.map((url, index) => (
                        <div key={index} className="aspect-square relative group overflow-hidden bg-gray-100">
                            <img src={url} alt={`Update ${index}`} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                                <a href={url} target="_blank" rel="noopener noreferrer" className="text-white text-xs uppercase tracking-widest border border-white px-3 py-1 hover:bg-white hover:text-black transition-colors">
                                    View
                                </a>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation(); // Prevent opening view if we had an onClick there
                                        handleDeleteImage(index);
                                    }}
                                    className="text-red-400 text-xs uppercase tracking-widest border border-red-400 px-3 py-1 hover:bg-red-500 hover:text-white transition-colors"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div >
    );
};

export default ProjectDetails;