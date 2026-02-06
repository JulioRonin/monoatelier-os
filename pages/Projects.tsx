import React, { useState, useEffect } from 'react';
import { MOCK_PROJECTS, MOCK_CLIENTS } from '../constants';
import { Project, ProjectStatus, Quote } from '../types';
import { Plus, ArrowRight, FileText, CheckCircle, XCircle, Calendar } from 'lucide-react';

import { api } from '../lib/api';

interface ProjectsProps {
    onNewProject: () => void;
    onProjectSelect: (id: string) => void;
    onAssignQuote: (quote: any) => void;
}

const Projects: React.FC<ProjectsProps> = ({ onNewProject, onProjectSelect, onAssignQuote }) => {
    const [projects, setProjects] = useState<Project[]>([]);
    const [clients, setClients] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Assign Project Modal State
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [quotes, setQuotes] = useState<Quote[]>([]);
    const [loadingQuotes, setLoadingQuotes] = useState(false);

    // Filters
    const [statusFilter, setStatusFilter] = useState<string>('All');
    const [clientFilter, setClientFilter] = useState<string>('All');

    useEffect(() => {
        Promise.all([
            api.getProjects(),
            api.getClients()
        ])
            .then(([projectsData, clientsData]) => {
                setProjects(projectsData);
                setClients(clientsData);
            })
            .catch(err => console.error("Failed to load data", err))
            .finally(() => setLoading(false));
    }, []);

    const handleOpenAssignModal = async () => {
        setShowAssignModal(true);
        setLoadingQuotes(true);
        try {
            const data = await api.getQuotes();
            // Optional: Filter quotes that are not yet projects? 
            // For now show all, maybe just 'Approved' or 'Pending' ones.
            // Let's show all for flexibility as per user request.
            setQuotes(data);
        } catch (e) {
            console.error("Failed to load quotes", e);
        } finally {
            setLoadingQuotes(false);
        }
    };

    const filteredProjects = projects.filter(p => {
        const matchesStatus = statusFilter === 'All' || p.status === statusFilter;
        const matchesClient = clientFilter === 'All' || p.clientId === clientFilter;
        return matchesStatus && matchesClient;
    });

    return (
        <div className="space-y-12 animate-fade-in relative">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-gray-100 dark:border-gray-800">
                <div>
                    <h1 className="font-serif text-4xl dark:text-white mb-2">Active Projects</h1>
                    <p className="text-xs font-mono uppercase tracking-widest text-gray-400 mb-6">Portfolio Management</p>

                    <div className="flex gap-4">
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-2 text-xs uppercase tracking-widest focus:outline-none dark:text-white"
                        >
                            <option value="All">All Status</option>
                            {Object.values(ProjectStatus).map(s => (
                                <option key={s} value={s}>{s.replace('_', ' ')}</option>
                            ))}
                        </select>

                        <select
                            value={clientFilter}
                            onChange={(e) => setClientFilter(e.target.value)}
                            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-2 text-xs uppercase tracking-widest focus:outline-none dark:text-white"
                        >
                            <option value="All">All Clients</option>
                            {clients.map(c => (
                                <option key={c.id} value={c.id}>{c.fullName}</option>
                            ))}
                        </select>
                    </div>
                </div>
                <div className="flex gap-4 self-start md:self-auto">
                    <button
                        onClick={handleOpenAssignModal}
                        className="bg-secondary text-white px-8 py-3 flex items-center gap-2 text-xs uppercase tracking-widest hover:bg-secondary/80 transition-colors"
                    >
                        <FileText size={16} />
                        Assign Project
                    </button>
                    <button
                        onClick={onNewProject}
                        className="bg-primary text-white dark:bg-white dark:text-primary px-8 py-3 flex items-center gap-2 text-xs uppercase tracking-widest hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
                    >
                        <Plus size={16} />
                        Initialize Project
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {loading ? (
                    <p className="text-gray-400 italic">Loading projects...</p>
                ) : filteredProjects.length === 0 ? (
                    <p className="text-gray-400 italic">No projects found matching filters.</p>
                ) : (
                    filteredProjects.map(project => (
                        <ProjectCard
                            key={project.id}
                            project={project}
                            client={clients.find(c => c.id === project.clientId)}
                            onClick={() => onProjectSelect(project.id)}
                        />
                    ))
                )}
            </div>

            {/* ASSIGN PROJECT MODAL */}
            {showAssignModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-white dark:bg-gray-800 w-full max-w-3xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
                        <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
                            <div>
                                <h2 className="font-serif text-2xl dark:text-white">Assign Quote to Project</h2>
                                <p className="text-xs text-gray-500 uppercase tracking-widest">Select a quote to initialize</p>
                            </div>
                            <button onClick={() => setShowAssignModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white">
                                <XCircle size={24} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                            {loadingQuotes ? (
                                <p className="text-center text-gray-400 py-8">Loading quotes...</p>
                            ) : quotes.length === 0 ? (
                                <p className="text-center text-gray-400 py-8">No quotes available.</p>
                            ) : (
                                <div className="space-y-3">
                                    {quotes.map(quote => (
                                        <div key={quote.id} className="group border border-gray-100 dark:border-gray-700 rounded-lg p-4 hover:border-primary transition-colors flex justify-between items-center bg-gray-50 dark:bg-gray-900/30">
                                            <div>
                                                <h3 className="font-serif text-lg text-gray-900 dark:text-white mb-1">{quote.projectName}</h3>
                                                <div className="text-xs text-gray-400 flex items-center gap-3">
                                                    <span>{quote.clientName}</span>
                                                    <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                                                    <span>{quote.date}</span>
                                                    <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                                                    <span className={`uppercase font-bold ${quote.status === 'Approved' ? 'text-green-500' : 'text-gray-500'}`}>{quote.status || 'Draft'}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-6">
                                                <div className="text-right">
                                                    <p className="text-xs uppercase tracking-widest text-gray-400">Total</p>
                                                    <p className="font-mono font-bold text-primary dark:text-white">${quote.totalAmount?.toLocaleString()}</p>
                                                </div>
                                                <button
                                                    onClick={() => onAssignQuote(quote)}
                                                    className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded text-[10px] uppercase font-bold tracking-widest hover:bg-primary hover:text-white hover:border-primary transition-all shadow-sm"
                                                >
                                                    Select
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const ProjectCard: React.FC<{ project: Project, client?: any, onClick: () => void }> = ({ project, client, onClick }) => {
    const isOverBudget = project.liveCost > project.budget;
    const margin = project.budget > 0 ? ((project.budget - project.liveCost) / project.budget) * 100 : 0;
    const profitAmount = project.budget - project.liveCost;

    // Status Logic
    const getStatusStyle = (status: ProjectStatus) => {
        switch (status) {
            case ProjectStatus.Completed: return 'bg-green-100 text-green-700 border-green-200';
            case ProjectStatus.In_Progress: return 'bg-blue-100 text-blue-700 border-blue-200';
            case ProjectStatus.Quote: return 'bg-gray-100 text-gray-600 border-gray-200';
            case ProjectStatus.Cancelled: return 'bg-red-50 text-red-500 border-red-100';
            default: return 'bg-gray-50 text-gray-500 border-gray-100';
        }
    };

    return (
        <div
            onClick={onClick}
            className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 p-8 group hover:-translate-y-1 transition-transform duration-300 cursor-pointer relative overflow-hidden"
        >
            {/* Corner Accent */}
            <div className={`absolute top-0 right-0 w-16 h-16 transform translate-x-8 -translate-y-8 rotate-45 ${isOverBudget ? 'bg-red-500/10' : 'bg-primary/5'}`}></div>

            <div className="flex justify-between items-start mb-6 relative z-10">
                <span className={`px-3 py-1.5 text-[10px] uppercase font-bold tracking-widest border rounded hover:opacity-80 transition-opacity ${getStatusStyle(project.status)}`}>
                    {project.status.replace('_', ' ')}
                </span>

                {/* Margin Indicator */}
                <div className="text-right">
                    <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Margin</p>
                    <p className={`font-mono text-sm font-bold ${margin < 15 ? 'text-red-500' : 'text-green-600'}`}>
                        {margin.toFixed(1)}%
                    </p>
                    <p className={`font-mono text-xs mt-1 ${profitAmount < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                        ${profitAmount.toLocaleString()}
                    </p>
                </div>
            </div>

            <div className="mb-6 relative z-10">
                <h3 className="font-serif text-2xl mb-2 dark:text-white group-hover:text-secondary transition-colors truncate" title={project.name}>
                    {project.name}
                </h3>
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-gray-300"></div>
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500">
                        {client?.fullName || 'Unknown Client'}
                    </p>
                </div>
                {project.dueDate && (
                    <div className="flex items-center gap-2 mt-2 text-gray-400">
                        <Calendar size={12} />
                        <p className="text-[10px] uppercase tracking-widest">
                            Due: {project.dueDate}
                        </p>
                    </div>
                )}
            </div>

            <div className="space-y-4 border-t border-gray-100 dark:border-gray-700 pt-6 relative z-10">
                <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Budget</span>
                    <span className="font-mono font-bold dark:text-gray-300">${project.budget.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Live Cost</span>
                    <span className={`font-mono font-bold ${isOverBudget ? 'text-danger' : 'dark:text-gray-300'}`}>
                        ${project.liveCost.toLocaleString()}
                    </span>
                </div>
            </div>

            <div className="mt-6 relative z-10">
                <div className="flex justify-between text-[10px] uppercase tracking-widest text-gray-400 mb-2">
                    <span>Progress</span>
                    <span>{project.progress}%</span>
                </div>
                <div className="w-full bg-gray-100 dark:bg-gray-700 h-1 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-1000 ${project.status === ProjectStatus.Completed ? 'bg-green-500' : 'bg-primary dark:bg-white'}`}
                        style={{ width: `${project.progress}%` }}
                    ></div>
                </div>
            </div>

            <div className="mt-6 flex justify-between items-center relative z-10">
                <p className="text-[10px] text-gray-400 uppercase tracking-widest">{project.phase}</p>
                <div className="flex -space-x-2">
                    {/* Team avatars placeholder - would be nice to map these too if real */}
                    {(project.team || []).map((t: string, i: number) => (
                        // If string is URL render img, else render initial
                        t.includes('http') ?
                            <img key={i} src={t} alt="Team" className="w-6 h-6 rounded-full border border-white dark:border-gray-800" /> :
                            <div key={i} className="w-6 h-6 rounded-full bg-gray-200 border border-white flex items-center justify-center text-[8px]">{t.substring(0, 2)}</div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Projects;