import React, { useState, useEffect } from 'react';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { api } from '../lib/api';
import { Project, Client, ProjectStatus } from '../types';
import {
    TrendingUp,
    DollarSign,
    PieChart,
    Calendar,
    ArrowUpRight,
    ArrowDownRight,
    MoreHorizontal,
    Eye,
    CheckCircle,
    XCircle,
    AlertCircle,
    Download,
    Filter
} from 'lucide-react';

// Extended interface for display
interface ProjectFinancials extends Project {
    clientName: string;
    totalPaid: number;
    balance: number;
    margin: number;
    marginPercent: number;
    isSuccess: boolean;
}

const Financials: React.FC = () => {
    const [projects, setProjects] = useState<ProjectFinancials[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedProject, setSelectedProject] = useState<ProjectFinancials | null>(null);
    const [allPayments, setAllPayments] = useState<any[]>([]);

    useEffect(() => {
        loadFinancialData();
    }, []);

    const loadFinancialData = async () => {
        try {
            setLoading(true);
            const [projectsData, clientsData, paymentsData] = await Promise.all([
                api.getProjects(),
                api.getClients(),
                api.getAllPayments()
            ]);

            setAllPayments(paymentsData);

            // Process and merge data
            const processedProjects = projectsData.map(p => {
                const client = clientsData.find((c: Client) => c.id === p.clientId);

                // Calculate Financials
                const projectPayments = paymentsData.filter((pay: any) => pay.projectId === p.id);
                const totalPaid = projectPayments.reduce((sum: number, pay: any) => sum + (pay.amount || 0), 0);

                // Assumption: Budget is the Selling Price. LiveCost is the Cost.
                const price = p.budget || 0;
                const cost = p.liveCost || 0;
                const margin = price - cost;
                const marginPercent = price > 0 ? (margin / price) * 100 : 0;
                const balance = price - totalPaid;

                // Success Criteria: Margin > 30%
                const isSuccess = marginPercent > 30;

                return {
                    ...p,
                    clientName: client ? client.fullName : 'Unknown Client',
                    totalPaid,
                    balance,
                    margin,
                    marginPercent,
                    isSuccess
                };
            });

            setProjects(processedProjects);
        } catch (e) {
            console.error("Failed to load financials", e);
        } finally {
            setLoading(false);
        }
    };

    // Date Filtering
    const [selectedMonth, setSelectedMonth] = useState<string>('All');
    const [selectedStatus, setSelectedStatus] = useState<string>('All');

    // Get unique months from projects
    const availableMonths = Array.from(new Set(projects.map(p => {
        if (!p.startDate) return '';
        return p.startDate.substring(0, 7); // YYYY-MM
    }))).filter(Boolean).sort().reverse();

    // Filter Logic
    const filteredProjects = projects.filter(p => {
        const matchesMonth = selectedMonth === 'All' || (p.startDate && p.startDate.startsWith(selectedMonth));
        const matchesStatus = selectedStatus === 'All' || p.status === selectedStatus;
        return matchesMonth && matchesStatus;
    });

    // Summary Metrics (Dynamic based on filter)
    const totalRevenue = filteredProjects.reduce((sum, p) => sum + p.budget, 0);
    const totalCost = filteredProjects.reduce((sum, p) => sum + p.liveCost, 0);
    const totalProfit = totalRevenue - totalCost;
    const avgMargin = filteredProjects.length > 0 ? totalProfit / totalRevenue * 100 : 0;

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount);
    };

    const formatMonth = (yyyyMm: string) => {
        const [year, month] = yyyyMm.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1);
        return date.toLocaleString('default', { month: 'long', year: 'numeric' });
    };

    const handleExport = async () => {
        try {
            const pdfDoc = await PDFDocument.create();
            const page = pdfDoc.addPage([842, 595]); // A4 Landscape
            const { width, height } = page.getSize();
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
            const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

            const drawText = (text: string, x: number, y: number, size = 10, isBold = false, color = rgb(0, 0, 0)) => {
                page.drawText(text, { x, y, size, font: isBold ? fontBold : font, color });
            };

            // Colors
            const colorPrimary = rgb(0.26, 0.48, 0.43); // #427a6e
            const colorText = rgb(0.2, 0.2, 0.2);
            const colorLight = rgb(0.5, 0.5, 0.5);

            // 1. Header
            drawText('Financial Overview', 40, height - 50, 24, true, colorPrimary);
            drawText(`Profitability & Margin Analysis • ${selectedMonth === 'All' ? 'All Time' : formatMonth(selectedMonth)}`, 40, height - 70, 10, false, colorLight);

            // 2. Summary Cards (Simulated)
            const cardY = height - 140;
            const cardWidth = 240;
            const cardHeight = 80;
            const gap = 20;

            // Card 1: Revenue
            drawText('TOTAL PROJECTED REVENUE', 40, cardY + 50, 8, true, colorLight);
            drawText(formatCurrency(totalRevenue), 40, cardY + 25, 20, true, colorText);
            drawText(`Across ${filteredProjects.length} Projects`, 40, cardY + 5, 10, false, colorPrimary);

            // Card 2: Net Profit
            const card2X = 40 + cardWidth + gap;
            drawText('NET PROFIT ESTIMATION', card2X, cardY + 50, 8, true, colorLight);
            drawText(formatCurrency(totalProfit), card2X, cardY + 25, 20, true, colorText);
            drawText('Expected Earnings', card2X, cardY + 5, 10, false, rgb(0.77, 0.31, 0.75)); // Accent

            // Card 3: Margin
            const card3X = card2X + cardWidth + gap;
            drawText('AVERAGE MARGIN', card3X, cardY + 50, 8, true, colorLight);
            drawText(`${avgMargin.toFixed(1)}%`, card3X, cardY + 25, 20, true, colorText);
            drawText(avgMargin > 30 ? 'Healthy Performance' : 'Attention Needed', card3X, cardY + 5, 10, false, avgMargin > 30 ? rgb(0.2, 0.6, 0.4) : rgb(0.9, 0.4, 0.1));

            // 3. Table Headers
            const tableY = height - 200;
            const colX = { name: 40, time: 250, cost: 400, margin: 550, balance: 650, success: 750 };

            drawText('PROJECT & CLIENT', colX.name, tableY, 9, true, colorLight);
            drawText('TIMELINE', colX.time, tableY, 9, true, colorLight);
            drawText('PRICE VS COST', colX.cost, tableY, 9, true, colorLight);
            drawText('MARGIN', colX.margin, tableY, 9, true, colorLight);
            drawText('BALANCE', colX.balance, tableY, 9, true, colorLight);
            drawText('SUCCESS', colX.success, tableY, 9, true, colorLight);

            // 4. Rows
            let rowY = tableY - 30;
            filteredProjects.forEach(p => {
                if (rowY < 40) { // New Page if needed
                    // For simplicity in this v1, we just stop or would create new page. 
                    // Let's just fit what we can or create simple single page report.
                    return;
                }

                drawText(p.name, colX.name, rowY + 10, 11, true, colorText);
                drawText(p.clientName, colX.name, rowY - 5, 9, false, colorLight);

                drawText(p.startDate || '-', colX.time, rowY + 10, 10, false, colorText);
                drawText(`Due: ${p.dueDate || '-'}`, colX.time, rowY - 5, 8, false, colorLight);

                drawText(formatCurrency(p.budget), colX.cost, rowY + 10, 10, false, colorText);
                drawText(`Cost: ${formatCurrency(p.liveCost)}`, colX.cost, rowY - 5, 8, false, colorLight);

                drawText(`${p.marginPercent.toFixed(0)}% NET`, colX.margin, rowY, 12, true, p.isSuccess ? rgb(0.2, 0.6, 0.4) : rgb(0.9, 0.4, 0.1));

                drawText(formatCurrency(p.balance), colX.balance, rowY + 10, 10, true, colorText);
                drawText(`${((p.totalPaid / p.budget) * 100).toFixed(0)}% Paid`, colX.balance, rowY - 5, 8, false, colorLight);

                drawText(p.isSuccess ? 'SUCCESS' : 'LOW MARGIN', colX.success, rowY, 9, true, p.isSuccess ? rgb(0.2, 0.6, 0.4) : rgb(0.9, 0.4, 0.1));

                // Separator line
                page.drawLine({
                    start: { x: 40, y: rowY - 15 },
                    end: { x: 800, y: rowY - 15 },
                    thickness: 0.5,
                    color: rgb(0.9, 0.9, 0.9),
                });

                rowY -= 50;
            });

            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Financial_Report_${selectedMonth}.pdf`;
            link.click();

        } catch (e) {
            console.error(e);
            alert("Error generating report");
        }
    };

    if (loading) return <div className="p-12 text-center text-gray-400">Loading Financial Intelligence...</div>;

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-gray-200 dark:border-gray-700 pb-6 gap-4">
                <div>
                    <h1 className="font-serif text-4xl dark:text-white mb-2 text-primary">Financial Overview</h1>
                    <p className="text-xs font-mono uppercase tracking-widest text-gray-400">Profitability & Margin Analysis</p>
                </div>
                <div className="flex gap-4">
                    {/* Filters */}
                    <div className="flex gap-4">
                        {/* Status Filter */}
                        <div className="relative">
                            <select
                                value={selectedStatus}
                                onChange={(e) => setSelectedStatus(e.target.value)}
                                className="appearance-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-3 pr-10 rounded-lg text-xs uppercase tracking-widest font-bold text-gray-500 focus:outline-none focus:border-primary transition-colors cursor-pointer"
                            >
                                <option value="All">All Status</option>
                                {Object.values(ProjectStatus).map(status => (
                                    <option key={status} value={status}>
                                        {status.replace('_', ' ')}
                                    </option>
                                ))}
                            </select>
                            <Filter size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>

                        {/* Month Filter */}
                        <div className="relative">
                            <select
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(e.target.value)}
                                className="appearance-none bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-4 py-3 pr-10 rounded-lg text-xs uppercase tracking-widest font-bold text-gray-500 focus:outline-none focus:border-primary transition-colors cursor-pointer"
                            >
                                <option value="All">All Time</option>
                                {availableMonths.map(month => (
                                    <option key={month as string} value={month as string}>
                                        {formatMonth(month as string)}
                                    </option>
                                ))}
                            </select>
                            <Calendar size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                    </div>

                    <button onClick={handleExport} className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs uppercase tracking-widest font-bold text-gray-500 hover:text-primary transition-colors shadow-sm rounded-lg">
                        <Download size={16} /> Export Report
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <DollarSign size={80} className="text-primary" />
                    </div>
                    <p className="text-xs uppercase tracking-widest text-gray-400 mb-2">Total Projected Revenue</p>
                    <h3 className="text-3xl font-serif text-gray-900 dark:text-white">{formatCurrency(totalRevenue)}</h3>
                    <div className="mt-4 flex items-center gap-2 text-xs text-primary bg-primary/10 w-fit px-2 py-1 rounded">
                        <TrendingUp size={14} />
                        <span>Across {filteredProjects.length} Projects</span>
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <PieChart size={80} className="text-accent" />
                    </div>
                    <p className="text-xs uppercase tracking-widest text-gray-400 mb-2">Net Profit Estimation</p>
                    <h3 className="text-3xl font-serif text-gray-900 dark:text-white">{formatCurrency(totalProfit)}</h3>
                    <div className="mt-4 flex items-center gap-2 text-xs text-accent bg-accent/10 w-fit px-2 py-1 rounded">
                        <span>Expected Earnings</span>
                    </div>
                </div>

                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <TrendingUp size={80} className="text-success" />
                    </div>
                    <p className="text-xs uppercase tracking-widest text-gray-400 mb-2">Average Margin</p>
                    <h3 className="text-3xl font-serif text-gray-900 dark:text-white">{avgMargin.toFixed(1)}%</h3>
                    <div className={`mt-4 flex items-center gap-2 text-xs w-fit px-2 py-1 rounded ${avgMargin > 30 ? 'text-success bg-success/10' : 'text-orange-500 bg-orange-100'}`}>
                        {avgMargin > 30 ? <ArrowUpRight size={14} /> : <AlertCircle size={14} />}
                        <span>{avgMargin > 30 ? 'Healthy Performance' : 'Attention Needed'}</span>
                    </div>
                </div>
            </div>

            {/* Main Table */}
            <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50 dark:bg-gray-900/50 text-[10px] uppercase tracking-widest text-gray-500 border-b border-gray-100 dark:border-gray-700">
                                <th className="p-6 font-semibold">Project & Client</th>
                                <th className="p-6 font-semibold">Timeline</th>
                                <th className="p-6 font-semibold text-right">Price vs Cost</th>
                                <th className="p-6 font-semibold text-center">Margin</th>
                                <th className="p-6 font-semibold text-right">Balance</th>
                                <th className="p-6 font-semibold text-center">Success</th>
                                <th className="p-6 font-semibold text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                            {filteredProjects.map(project => (
                                <tr key={project.id} className="group hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                                    <td className="p-6">
                                        <div className="font-serif text-lg text-gray-900 dark:text-white mb-1 group-hover:text-primary transition-colors">{project.name}</div>
                                        <div className="text-xs text-gray-400 flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-secondary"></span>
                                            {project.clientName}
                                        </div>
                                    </td>
                                    <td className="p-6">
                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                            <Calendar size={14} className="text-gray-300" />
                                            <span>{project.startDate || 'N/A'}</span>
                                        </div>
                                        <div className="text-[10px] text-gray-400 mt-1 pl-6">
                                            Due: {project.dueDate || 'TBD'}
                                        </div>
                                    </td>
                                    <td className="p-6 text-right">
                                        <div className="font-mono text-sm text-gray-900 dark:text-gray-200">{formatCurrency(project.budget)}</div>
                                        <div className="text-xs text-gray-400 mt-1">
                                            Cost: {formatCurrency(project.liveCost)}
                                        </div>
                                    </td>
                                    <td className="p-6 text-center">
                                        <div className={`inline-flex flex-col items-center justify-center w-16 h-16 rounded-full border-2 ${project.isSuccess ? 'border-success/30 bg-success/5' : 'border-red-200 bg-red-50 dark:bg-red-900/10'}`}>
                                            <span className={`text-sm font-bold ${project.isSuccess ? 'text-success' : 'text-red-500'}`}>{project.marginPercent.toFixed(0)}%</span>
                                            <span className="text-[9px] uppercase text-gray-400">Net</span>
                                        </div>
                                    </td>
                                    <td className="p-6 text-right">
                                        <div className={`font-mono text-sm font-bold ${project.balance <= 0 ? 'text-success' : 'text-gray-900 dark:text-white'}`}>
                                            {formatCurrency(project.balance)}
                                        </div>
                                        <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2 ml-auto max-w-[100px]">
                                            <div
                                                className="bg-primary h-1.5 rounded-full"
                                                style={{ width: `${Math.min((project.totalPaid / project.budget) * 100, 100)}%` }}
                                            ></div>
                                        </div>
                                        <div className="text-[10px] text-gray-400 mt-1">
                                            {((project.totalPaid / project.budget) * 100).toFixed(0)}% Paid
                                        </div>
                                    </td>
                                    <td className="p-6 text-center">
                                        {project.isSuccess ? (
                                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-success/10 text-success text-[10px] font-bold uppercase tracking-wider">
                                                <CheckCircle size={12} /> Success
                                            </div>
                                        ) : (
                                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-50 text-red-500 text-[10px] font-bold uppercase tracking-wider">
                                                <XCircle size={12} /> Low Margin
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-6 text-center">
                                        <button
                                            onClick={() => setSelectedProject(project)}
                                            className="p-2 text-gray-400 hover:text-primary dark:text-gray-500 dark:hover:text-white transition-colors"
                                            title="View Financial Details"
                                        >
                                            <Eye size={18} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Detail Modal */}
            {selectedProject && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm animate-fade-in p-4">
                    <div className="bg-white dark:bg-gray-800 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        {/* Modal Header */}
                        <div className="p-8 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex justify-between items-start">
                            <div>
                                <div className="flex items-center gap-3 mb-2">
                                    <h2 className="font-serif text-3xl text-primary dark:text-white">{selectedProject.name}</h2>
                                    <span className={`px-3 py-1 text-[10px] uppercase font-bold tracking-widest rounded-full ${selectedProject.isSuccess ? 'bg-success text-white' : 'bg-red-500 text-white'}`}>
                                        {selectedProject.isSuccess ? 'Healthy Project' : 'Low Margin'}
                                    </span>
                                </div>
                                <p className="text-sm text-gray-500">{selectedProject.clientName} • {selectedProject.id}</p>
                            </div>
                            <button onClick={() => setSelectedProject(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white">
                                <XCircle size={24} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                            {/* Detailed Stats */}
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                                <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700">
                                    <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Contract Value</p>
                                    <p className="text-xl font-serif text-gray-900 dark:text-white">{formatCurrency(selectedProject.budget)}</p>
                                </div>
                                <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700">
                                    <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Total Expenses</p>
                                    <p className="text-xl font-serif text-gray-900 dark:text-white">{formatCurrency(selectedProject.liveCost)}</p>
                                </div>
                                <div className="p-4 bg-secondary/10 rounded-xl border border-secondary/20">
                                    <p className="text-[10px] uppercase tracking-widest text-primary mb-1">Net Margin</p>
                                    <p className="text-xl font-serif text-primary">{formatCurrency(selectedProject.margin)}</p>
                                </div>
                                <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700">
                                    <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Balance Due</p>
                                    <p className="text-xl font-serif text-gray-900 dark:text-white">{formatCurrency(selectedProject.balance)}</p>
                                </div>
                            </div>

                            {/* Payment History */}
                            <div className="mb-8">
                                <h3 className="font-serif text-xl mb-4 flex items-center gap-2 dark:text-white">
                                    <DollarSign size={20} className="text-success" /> Payment History
                                </h3>
                                <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                                    <table className="w-full text-left">
                                        <thead className="bg-gray-50 dark:bg-gray-900 text-[10px] uppercase tracking-widest text-gray-500">
                                            <tr>
                                                <th className="p-4 font-normal">Date</th>
                                                <th className="p-4 font-normal">Method</th>
                                                <th className="p-4 font-normal">Amount</th>
                                                <th className="p-4 font-normal">Reference/Notes</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                            {allPayments.filter(p => p.projectId === selectedProject.id).length > 0 ? (
                                                allPayments
                                                    .filter(p => p.projectId === selectedProject.id)
                                                    .map(pay => (
                                                        <tr key={pay.id}>
                                                            <td className="p-4 text-sm text-gray-600 dark:text-gray-300">{pay.date}</td>
                                                            <td className="p-4 text-sm font-medium dark:text-white">{pay.method}</td>
                                                            <td className="p-4 text-sm font-bold text-success">{formatCurrency(pay.amount)}</td>
                                                            <td className="p-4 text-xs text-gray-400 italic">{pay.notes || '-'}</td>
                                                        </tr>
                                                    ))
                                            ) : (
                                                <tr>
                                                    <td colSpan={4} className="p-6 text-center text-sm text-gray-400 italic">No payments recorded yet.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Margin Viz */}
                            <div>
                                <h3 className="font-serif text-xl mb-4 dark:text-white">Profitability Analysis</h3>
                                <div className="w-full h-4 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden flex">
                                    <div
                                        className="h-full bg-gray-400"
                                        style={{ width: `${(selectedProject.liveCost / selectedProject.budget) * 100}%` }}
                                        title="Cost"
                                    ></div>
                                    <div
                                        className="h-full bg-success"
                                        style={{ width: `${(selectedProject.margin / selectedProject.budget) * 100}%` }}
                                        title="Profit"
                                    ></div>
                                </div>
                                <div className="flex justify-between text-xs text-gray-400 mt-2">
                                    <span>Cost Coverage ({((selectedProject.liveCost / selectedProject.budget) * 100).toFixed(0)}%)</span>
                                    <span>Profit Margin ({selectedProject.marginPercent.toFixed(1)}%)</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Financials;
