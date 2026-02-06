import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Project, ProjectStatus } from '../types';
import { Clock, CheckCircle, AlertTriangle, Calendar, ArrowRight, Layout } from 'lucide-react';

const UserDashboard: React.FC = () => {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadProjects();
    }, []);

    const loadProjects = async () => {
        try {
            const data = await api.getProjects();
            // In a real app, filter by current user's ID
            setProjects(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const activeProjects = projects.filter(p => p.status === ProjectStatus.In_Progress);
    const completedProjects = projects.filter(p => p.status === ProjectStatus.Completed);

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            <div>
                <h1 className="font-serif text-4xl dark:text-white mb-2">My Workspace</h1>
                <p className="text-xs font-mono uppercase tracking-widest text-gray-400">Managing {activeProjects.length} Active Projects</p>
            </div>

            {/* Status Overview Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-blue-50 text-blue-600 rounded-full"><Clock size={24} /></div>
                    <div>
                        <p className="text-[10px] uppercase tracking-widest text-gray-400">In Progress</p>
                        <p className="text-2xl font-serif dark:text-white">{activeProjects.length}</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-green-50 text-green-600 rounded-full"><CheckCircle size={24} /></div>
                    <div>
                        <p className="text-[10px] uppercase tracking-widest text-gray-400">Completed</p>
                        <p className="text-2xl font-serif dark:text-white">{completedProjects.length}</p>
                    </div>
                </div>
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-purple-50 text-purple-600 rounded-full"><Layout size={24} /></div>
                    <div>
                        <p className="text-[10px] uppercase tracking-widest text-gray-400">Total Projects</p>
                        <p className="text-2xl font-serif dark:text-white">{projects.length}</p>
                    </div>
                </div>
            </div>

            {/* Active Projects Grid */}
            <div>
                <h2 className="font-serif text-2xl dark:text-white mb-6">Active Projects</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {activeProjects.map(project => (
                        <div key={project.id} className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 hover:shadow-lg transition-all group">
                            <div className="flex justify-between items-start mb-4">
                                <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-[10px] uppercase font-bold tracking-widest">{project.status}</span>
                                <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider ${project.priority === 'High' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>{project.priority} Priority</span>
                            </div>

                            <h3 className="font-serif text-xl dark:text-white mb-1">{project.name}</h3>
                            <p className="text-xs text-gray-400 uppercase tracking-widest mb-6">Next Milestone: {project.phase}</p>

                            {/* Progress */}
                            <div className="mb-6">
                                <div className="flex justify-between text-xs mb-2">
                                    <span className="text-gray-500">Completion</span>
                                    <span className="font-bold dark:text-white">{project.progress}%</span>
                                </div>
                                <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-primary dark:bg-white transition-all duration-500" style={{ width: `${project.progress}%` }}></div>
                                </div>
                            </div>

                            <div className="flex justify-between items-center border-t border-gray-100 dark:border-gray-700 pt-4">
                                <div className="flex items-center gap-2 text-gray-500 text-xs">
                                    <Calendar size={14} />
                                    <span>Due: {project.dueDate || 'TBD'}</span>
                                </div>
                                <button className="text-primary dark:text-white text-[10px] uppercase font-bold tracking-widest flex items-center gap-2 hover:underline">
                                    Manage Project <ArrowRight size={14} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default UserDashboard;
