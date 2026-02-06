import React, { useState, useMemo, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, ReferenceLine, CartesianGrid } from 'recharts';
import { api } from '../lib/api';
import { Project, ProjectStatus } from '../types';
import { AlertCircle, Calendar, TrendingUp, DollarSign, Activity, Filter, CheckCircle, Clock } from 'lucide-react';

const Dashboard: React.FC = () => {
    const [statusFilter, setStatusFilter] = useState<string>('All');
    const [timeFilter, setTimeFilter] = useState<string>('All Time');
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadDashboardData = async () => {
            try {
                const [projectsData, clientsData, allPayments] = await Promise.all([
                    api.getProjects(),
                    api.getClients(),
                    api.getAllPayments()
                ]);

                // Map payments to projects
                const projectsWithPayments = projectsData.map(p => {
                    const projectPayments = allPayments.filter((pay: any) => pay.projectId === p.id);
                    const totalPaid = projectPayments.reduce((sum: number, pay: any) => sum + (Number(pay.amount) || 0), 0);
                    return { ...p, paid: totalPaid };
                });

                setProjects(projectsWithPayments);
                // setClients(clientsData); // Not strictly used in this component but good to have if needed
            } catch (e) {
                console.error("Dashboard load failed", e);
            } finally {
                setLoading(false);
            }
        };
        loadDashboardData();
    }, []);

    // --- Dynamic Time Options ---
    const availableMonths = useMemo(() => {
        const months = new Set<string>();
        projects.forEach(p => {
            if (p.dueDate) {
                const date = new Date(p.dueDate);
                const formatter = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' });
                months.add(formatter.format(date)); // e.g., "octubre 2025"
            }
        });
        return Array.from(months).sort((a, b) => {
            // Sort roughly by parsing back or just string sort for now (ideally verify sorting)
            // For simplicity in this step, let's keep it simple or use timestamp map.
            // A better way is to store "YYYY-MM" as value and Label as display.
            return 0;
        });
    }, [projects]);

    // Enhanced Month Options with YYYY-MM values for sorting
    const monthOptions = useMemo(() => {
        const options = projects
            .filter(p => p.dueDate)
            .map(p => {
                const d = new Date(p.dueDate!);
                return {
                    value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
                    label: d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
                };
            });

        // Deduplicate by value
        const unique = new Map();
        options.forEach(o => unique.set(o.value, o.label));

        return Array.from(unique.entries())
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => b.value.localeCompare(a.value)); // Newest first
    }, [projects]);


    // --- Data Filtering & Processing ---
    const filteredProjects = useMemo(() => {
        let filtered = projects;

        // 1. Status Filter
        if (statusFilter !== 'All') {
            if (statusFilter === 'Active') {
                filtered = filtered.filter(p => p.status === ProjectStatus.In_Progress);
            } else if (statusFilter === 'Completed') {
                filtered = filtered.filter(p => p.status === ProjectStatus.Completed);
            } else if (statusFilter === 'Quote') {
                filtered = filtered.filter(p => p.status === ProjectStatus.Quote);
            } else if (statusFilter === 'Cancelled') {
                filtered = filtered.filter(p => p.status === ProjectStatus.Cancelled);
            }
        }

        // 2. Time Filter (Month Based)
        if (timeFilter !== 'All Time') {
            filtered = filtered.filter(p => {
                if (!p.dueDate) return false;
                const d = new Date(p.dueDate);
                const projectMonthVal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                return projectMonthVal === timeFilter;
            });
        }

        return filtered;
    }, [statusFilter, timeFilter, projects]);

    // --- KPI Calculations ---
    const kpiData = useMemo(() => {
        // Sales: Sum of budget for "Sold" projects (In Progress or Completed)
        const relevantForFinancials = filteredProjects.filter(p => p.status !== ProjectStatus.Quote && p.status !== ProjectStatus.No_Achieve && p.status !== ProjectStatus.Cancelled);

        const totalSales = relevantForFinancials.reduce((sum, p) => sum + p.budget, 0);
        const totalCost = relevantForFinancials.reduce((sum, p) => sum + p.liveCost, 0);
        const totalPaid = filteredProjects.reduce((sum, p) => sum + ((p as any).paid || 0), 0);

        const totalProfit = totalSales - totalCost;
        const totalMargin = totalSales > 0 ? ((totalSales - totalCost) / totalSales) * 100 : 0;
        const activeProjectsCount = filteredProjects.filter(p => p.status === ProjectStatus.In_Progress).length;

        return {
            sales: totalSales,
            cost: totalCost,
            profit: totalProfit,
            paid: totalPaid,
            margin: totalMargin,
            activeCount: activeProjectsCount
        };
    }, [filteredProjects]);

    // --- Financial Chart Data Preparation ---
    const financialData = useMemo(() => {
        return filteredProjects
            .filter(p => p.status !== ProjectStatus.Quote && p.status !== ProjectStatus.Cancelled) // Only show active/completed/financials
            .map(p => ({
                id: p.id,
                name: p.name,
                budget: p.budget,
                liveCost: p.liveCost,
                profit: p.budget - p.liveCost,
                paid: (p as any).paid || 0,
                status: p.status
            }))
            .sort((a, b) => b.budget - a.budget); // Sort by highest budget
    }, [filteredProjects]);

    // --- Alerts Logic ---
    const alerts = useMemo(() => {
        const list: any[] = [];
        const today = new Date();

        filteredProjects.forEach(p => {
            // Financial Risk
            if (p.liveCost > p.budget) {
                list.push({
                    id: `fin-${p.id}`,
                    project: p.name,
                    type: 'Over Budget',
                    message: `Budget: $${p.budget.toLocaleString()} vs Cost: $${p.liveCost.toLocaleString()}`,
                    severity: 'high'
                });
            }
            // Time Risk
            if (p.dueDate && p.status === ProjectStatus.In_Progress) {
                const due = new Date(p.dueDate);
                if (due < today) {
                    list.push({
                        id: `time-${p.id}`,
                        project: p.name,
                        type: 'Overdue',
                        message: `Due date was ${p.dueDate}`,
                        severity: 'high'
                    });
                } else if ((due.getTime() - today.getTime()) < (7 * 24 * 60 * 60 * 1000)) { // Within 7 days
                    list.push({
                        id: `warn-${p.id}`,
                        project: p.name,
                        type: 'Due Soon',
                        message: `Due in ${Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))} days`,
                        severity: 'medium'
                    });
                }
            }
        });
        return list;
    }, [filteredProjects]);

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            {/* Header & Filters */}
            <div className="flex flex-col md:flex-row md:items-end justify-between border-b border-gray-200 dark:border-gray-700 pb-6 gap-4">
                <div>
                    <h1 className="font-serif text-3xl md:text-4xl dark:text-white mb-2">Executive Dashboard</h1>
                    <p className="text-xs font-mono uppercase tracking-widest text-gray-500">Performance Overview</p>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap gap-4 items-center bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-2">
                        <Filter size={14} className="text-gray-400" />
                        <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Filters:</span>
                    </div>

                    <select
                        value={timeFilter}
                        onChange={(e) => setTimeFilter(e.target.value)}
                        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-xs px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-primary min-w-[120px] capitalize"
                    >
                        <option value="All Time">All Time</option>
                        {monthOptions.map(opt => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>

                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-xs px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-primary min-w-[120px]"
                    >
                        <option value="All">All Statuses</option>
                        <option value="Active">Active Only</option>
                        <option value="Completed">Completed</option>
                        <option value="Quote">Quotes</option>
                        <option value="Cancelled">Cancelled</option>
                    </select>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <KPICard
                    title="Total Sales"
                    value={`$${(kpiData.sales / 1000).toFixed(1)}k`}
                    icon={<DollarSign size={20} />}
                    trend="+12%"
                    positive
                    subtext="Invoiced Revenue"
                />
                <KPICard
                    title="Total Cost"
                    value={`$${(kpiData.cost / 1000).toFixed(1)}k`}
                    icon={<Activity size={20} />}
                    trend="+5%"
                    positive={false} // Cost going up is usually bad, or neutral if matching revenue
                    subtext="Project Expenses"
                />
                <KPICard
                    title="Net Profit"
                    value={`$${(kpiData.profit / 1000).toFixed(1)}k`}
                    icon={<TrendingUp size={20} />}
                    trend={`${kpiData.margin.toFixed(1)}%`}
                    positive={kpiData.margin > 20}
                    subtext="Net Margin"
                />
                <KPICard
                    title="Total Collected"
                    value={`$${(kpiData.paid / 1000).toFixed(1)}k`}
                    icon={<CheckCircle size={20} />}
                    subtext={`${kpiData.sales > 0 ? ((kpiData.paid / kpiData.sales) * 100).toFixed(0) : 0}% of Sales`}
                    neutral
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Custom Financial Timeline List */}
                <div className="lg:col-span-2 bg-white dark:bg-gray-800 p-8 shadow-sm border border-gray-100 dark:border-gray-700 rounded-xl">
                    <div className="flex justify-between items-center mb-10">
                        {/* Legend */}
                        <div className="flex flex-wrap gap-6">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-gray-200"></div>
                                <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Planned</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-black dark:bg-gray-600"></div>
                                <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Logged Cost</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-yellow-600"></div>
                                <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Invoiced</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-emerald-700"></div>
                                <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">Paid</span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-12">
                        {financialData.length > 0 ? (
                            financialData.map(item => (
                                <div
                                    key={item.id}
                                    onClick={() => window.location.hash = `#/project/${item.id}`}
                                    className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center p-4 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors border border-transparent hover:border-gray-100 dark:hover:border-gray-700"
                                >
                                    {/* Left Info */}
                                    <div className="md:col-span-4">
                                        <h4 className="font-serif text-xl dark:text-white truncate mb-1" title={item.name}>{item.name}</h4>
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-[10px] uppercase tracking-widest text-gray-400">JOB #{item.id?.substring(0, 4).toUpperCase()}</span>
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${item.status === 'In Progress' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                                {item.status}
                                            </span>
                                        </div>
                                        <div className="flex gap-2 font-mono text-xs">
                                            <span className="font-bold text-emerald-700 dark:text-emerald-400">${item.paid.toLocaleString()}</span>
                                            <span className="text-gray-300">/</span>
                                            <span className="text-gray-400">${item.budget.toLocaleString()}</span>
                                        </div>
                                    </div>

                                    {/* Right Bars */}
                                    <div className="md:col-span-8 flex flex-col gap-2">
                                        {/* Planned (Background Ref) */}
                                        <div className="h-1.5 w-full bg-gray-100 dark:bg-gray-900 rounded-full overflow-hidden">
                                            <div className="h-full bg-gray-200" style={{ width: '100%' }}></div>
                                        </div>

                                        {/* Logged Cost */}
                                        <div className="h-2 w-full bg-gray-100 dark:bg-gray-900 rounded-full overflow-hidden relative group">
                                            <div
                                                className={`h-full ${item.liveCost > item.budget ? 'bg-red-500' : 'bg-black dark:bg-gray-400'}`}
                                                style={{ width: `${Math.min((item.liveCost / (item.budget * 1.1)) * 100, 100)}%` }}
                                            ></div>
                                        </div>

                                        {/* Invoiced - Assuming Budget is Invoiced for now */}
                                        <div className="h-2 w-full bg-gray-100 dark:bg-gray-900 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-yellow-600"
                                                style={{ width: `${Math.min((item.budget / (item.budget * 1.1)) * 100, 100)}%` }}
                                            ></div>
                                        </div>

                                        {/* Paid */}
                                        <div className="h-2 w-full bg-gray-100 dark:bg-gray-900 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-emerald-700"
                                                style={{ width: `${Math.min(((item as any).paid || 0) / (item.budget * 1.1) * 100, 100)}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <p className="text-gray-400 italic text-center py-12">No active financial data.</p>
                        )}
                    </div>
                </div>

                {/* Urgent Attention / Alerts */}
                <div className="bg-white dark:bg-gray-800 p-8 shadow-sm border border-gray-100 dark:border-gray-700 rounded-xl flex flex-col h-[400px]">
                    <div className="flex items-center gap-2 mb-6 text-danger">
                        <AlertCircle size={24} />
                        <h3 className="font-serif italic text-2xl text-gray-900 dark:text-white">Urgent & Alerts</h3>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                        {alerts.length > 0 ? alerts.map(alert => (
                            <div key={alert.id} className={`p-4 rounded border-l-4 ${alert.severity === 'high' ? 'border-red-500 bg-red-50 dark:bg-red-900/10' : 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10'}`}>
                                <div className="flex justify-between items-start mb-1">
                                    <h4 className="font-bold text-sm text-gray-900 dark:text-gray-100">{alert.project}</h4>
                                    <span className={`text-[10px] font-bold uppercase tracking-widest ${alert.severity === 'high' ? 'text-red-600' : 'text-yellow-600'}`}>
                                        {alert.type}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-600 dark:text-gray-400">{alert.message}</p>
                            </div>
                        )) : (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-2">
                                <CheckCircle size={32} className="text-green-500 opacity-50" />
                                <p className="text-sm italic">All systems healthy.</p>
                                <p className="text-xs text-gray-300">No urgent alerts for filtered projects.</p>
                            </div>
                        )}
                    </div>

                    {alerts.length > 0 && (
                        <button className="mt-4 w-full py-3 border border-gray-200 dark:border-gray-600 text-[10px] uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors dark:text-gray-300 rounded">
                            Dismiss All
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

const KPICard: React.FC<{
    title: string,
    value: string,
    icon?: React.ReactNode,
    trend?: string,
    positive?: boolean,
    neutral?: boolean,
    subtext?: string
}> = ({ title, value, icon, trend, positive, neutral, subtext }) => (
    <div className="bg-white dark:bg-gray-800 p-6 border border-gray-100 dark:border-gray-700 rounded-xl hover:shadow-lg transition-all duration-300 group">
        <div className="flex justify-between items-start mb-4">
            <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold flex items-center gap-2">
                {title}
            </span>
            {icon && <div className="text-gray-300 group-hover:text-primary dark:group-hover:text-white transition-colors">{icon}</div>}
        </div>
        <div className="flex items-baseline gap-3 mb-2">
            <h3 className="font-serif text-4xl text-primary dark:text-white">{value}</h3>
        </div>

        <div className="flex items-center justify-between">
            {subtext && <p className="text-[10px] text-gray-400 italic">{subtext}</p>}
            {trend && (
                <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${neutral ? 'bg-gray-100 text-gray-600' : positive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {trend}
                </span>
            )}
        </div>
    </div>
);

export default Dashboard;

