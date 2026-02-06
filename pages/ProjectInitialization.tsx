import React, { useState, useEffect } from 'react';
import { PhaseEnum, ProjectStatus } from '../types';
import { MOCK_MANAGERS } from '../constants';
import { ChevronDown, DollarSign, Percent, FileText } from 'lucide-react';
import { api } from '../lib/api';

interface InitProps {
    onCancel: () => void;
    initialData?: any;
}

const ProjectInitialization: React.FC<InitProps> = ({ onCancel, initialData }) => {
    // Form State
    const [name, setName] = useState('');
    const [clientCode, setClientCode] = useState('');
    const [location, setLocation] = useState('');
    const [selectedClientId, setSelectedClientId] = useState('');
    const [selectedPM, setSelectedPM] = useState('');
    const [startDate, setStartDate] = useState('');

    const [contingency, setContingency] = useState(8); // Percentage
    const [marginTarget, setMarginTarget] = useState(15); // Percentage
    const [status, setStatus] = useState<ProjectStatus>(ProjectStatus.In_Progress); // Default to Active/In Progress when initializing
    const [progress, setProgress] = useState(0);
    const [cost, setCost] = useState<number>(0);
    const [sellPrice, setSellPrice] = useState<number>(0);
    const [isBillable, setIsBillable] = useState(false);

    // Data Sources
    const [clients, setClients] = useState<any[]>([]);
    const [teamMembers, setTeamMembers] = useState<any[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        Promise.all([
            api.getClients(),
            api.getTeamMembers()
        ]).then(([clientsData, teamData]) => {
            setClients(clientsData);
            setTeamMembers(teamData);

            // Pre-fill from Initial Data (Quote)
            if (initialData) {
                console.log("Initializing from data", initialData);
                setName(initialData.name || '');
                setSellPrice(Number(initialData.budget) || 0);

                // Match Client
                if (initialData.clientName) {
                    const match = clientsData.find((c: any) => c.fullName.toLowerCase() === initialData.clientName.toLowerCase());
                    if (match) {
                        setSelectedClientId(match.id);
                    }
                }

                // Set default status to In Progress
                setStatus(ProjectStatus.In_Progress);
            }
        }).catch(console.error);
    }, [initialData]);

    // Handler: When User inputs Cost
    const effectiveCost = cost * (1 + contingency / 100);

    // User Request: Gross Margin = Sell Price - Estimated Cost (Raw)
    const grossMarginAmount = sellPrice - cost;
    const grossMarginPercent = sellPrice > 0 ? (grossMarginAmount / sellPrice) * 100 : 0;

    // Handler: When User inputs Cost
    // Action: Recalculates Margin Target based on current Sell Price
    const handleCostChange = (val: number) => {
        setCost(val);
        const newEffectiveCost = val * (1 + contingency / 100);
        if (sellPrice > 0) {
            // Keep Price, update Margin Target visual
            const newMargin = ((sellPrice - newEffectiveCost) / sellPrice) * 100;
            setMarginTarget(Math.round(newMargin * 10) / 10);
        } else if (marginTarget > 0 && val > 0) {
            // If no price yet, calculate it based on target
            const denom = 1 - (marginTarget / 100);
            const newPrice = newEffectiveCost / denom;
            setSellPrice(Math.round(newPrice * 100) / 100);
        }
    };

    // Handler: When User inputs Sell Price
    // Action: Recalculates Margin Target (Slider)
    const handleSellPriceInput = (val: number) => {
        setSellPrice(val);
        if (val > 0) {
            const currentMargin = ((val - effectiveCost) / val) * 100;
            setMarginTarget(Math.round(currentMargin * 10) / 10);
        } else {
            setMarginTarget(0);
        }
    };

    // Handler: When User moves Contingency Slider
    // Action: Updates Sell Price to maintain the Profit Margin Target
    const handleContingencyChange = (val: number) => {
        setContingency(val);
        const newEffectiveCost = cost * (1 + val / 100);

        // Drive Price Change
        const denom = 1 - (marginTarget / 100);
        if (denom > 0 && cost > 0) {
            const newPrice = newEffectiveCost / denom;
            setSellPrice(Math.round(newPrice * 100) / 100);
        }
    };

    // Handler: When User moves Margin Target Slider
    // Action: Updates Sell Price to match the desired Margin
    const handleMarginTargetChange = (val: number) => {
        setMarginTarget(val);
        // Formula: SellPrice = EffectiveCost / (1 - Margin%)
        const denom = 1 - (val / 100);
        if (denom > 0 && cost > 0) {
            const newPrice = effectiveCost / denom;
            setSellPrice(Math.round(newPrice * 100) / 100);
        }
    };

    const handleCreate = async () => {
        if (!name || !selectedClientId) {
            alert('Please fill in Project Name and select a Client.');
            return;
        }

        try {
            setSaving(true);
            await api.createProject({
                name,
                clientId: selectedClientId,
                status,
                startDate,
                progress,
                budget: sellPrice, // Using Sell Price as the Budget for the client
                liveCost: cost,     // Internal Cost
                phase: PhaseEnum.Quote, // Default starting phase
                team: selectedPM ? [selectedPM] : [], // Store PM avatar or ID. For now assume storing name/ID string.
                projectOverview: `Location: ${location}. Client Code: ${clientCode}`
            });
            alert('Project created successfully!');
            onCancel(); // Close modal and refresh
        } catch (e: any) {
            console.error(e);
            alert(`Failed to create project: ${e.message}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto animate-fade-in pb-20">
            <div className="text-center py-12">
                <p className="text-[10px] uppercase tracking-[0.4em] text-gray-400 mb-4">Project Initialization</p>
                <h1 className="font-serif text-5xl dark:text-white">Create New <span className="italic text-gray-400">Architecture</span> Project</h1>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-16 mb-16">
                <div className="space-y-8">
                    <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Project Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Type here..."
                            className="w-full bg-transparent text-2xl font-serif dark:text-white focus:outline-none placeholder-gray-200"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-8">
                        <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Client Code</label>
                            <input
                                type="text"
                                value={clientCode}
                                onChange={e => setClientCode(e.target.value)}
                                placeholder="CLI-####"
                                className="w-full bg-transparent text-xl font-mono text-gray-600 dark:text-gray-300 focus:outline-none placeholder-gray-200"
                            />
                        </div>
                        <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Status</label>
                            <div className="relative">
                                <select
                                    value={status}
                                    onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                                    className="w-full bg-transparent text-lg font-light dark:text-white focus:outline-none appearance-none py-1 pr-8 cursor-pointer"
                                >
                                    {Object.values(ProjectStatus).map((s) => (
                                        <option key={s} value={s} className="text-base text-primary dark:text-white bg-white dark:bg-gray-800">
                                            {s.replace('_', ' ')}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                            </div>
                        </div>
                    </div>

                    <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Project Manager</label>
                        <div className="relative">
                            <select
                                className="w-full bg-transparent text-xl font-light dark:text-white focus:outline-none appearance-none py-1 pr-8 cursor-pointer"
                                value={selectedPM}
                                onChange={e => setSelectedPM(e.target.value)}
                            >
                                <option value="" disabled className="text-gray-400">Select PM...</option>
                                {teamMembers.length > 0 ? (
                                    teamMembers.map((pm) => (
                                        <option key={pm.id} value={pm.full_name} className="text-base text-primary dark:text-white bg-white dark:bg-gray-800">
                                            {pm.full_name} - {pm.role}
                                        </option>
                                    ))
                                ) : (
                                    // Fallback if no db data yet
                                    MOCK_MANAGERS.map((pm) => (
                                        <option key={pm} value={pm} className="text-base text-primary dark:text-white bg-white dark:bg-gray-800">
                                            {pm}
                                        </option>
                                    ))
                                )}
                            </select>
                            <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={20} />
                        </div>
                    </div>
                </div>
                <div className="space-y-8">
                    <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Location</label>
                        <input
                            type="text"
                            value={location}
                            onChange={e => setLocation(e.target.value)}
                            placeholder="Search address..."
                            className="w-full bg-transparent text-xl font-light dark:text-white focus:outline-none placeholder-gray-200"
                        />
                    </div>
                    <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Client Contact</label>
                        <div className="relative">
                            <select
                                className="w-full bg-transparent text-xl font-light dark:text-white focus:outline-none appearance-none py-1 pr-8 cursor-pointer"
                                value={selectedClientId}
                                onChange={e => setSelectedClientId(e.target.value)}
                            >
                                <option value="" disabled className="text-gray-400">Select Client...</option>
                                {clients.map((client) => (
                                    <option key={client.id} value={client.id} className="text-base text-primary dark:text-white bg-white dark:bg-gray-800">
                                        {client.fullName}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={20} />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-8">
                        <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Estimated Start Date</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={e => setStartDate(e.target.value)}
                                className="w-full bg-transparent text-lg font-mono text-gray-600 dark:text-gray-300 focus:outline-none"
                            />
                        </div>
                        <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Initial Progress: {progress}%</label>
                            <input
                                type="range" min="0" max="100" value={progress}
                                onChange={(e) => setProgress(parseInt(e.target.value))}
                                className="w-full h-[2px] bg-gray-200 rounded-lg appearance-none cursor-pointer mt-3"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Phases */}
            <div className="mb-16">
                <div className="flex items-center gap-4 mb-8">
                    <span className="font-mono text-xs text-gray-400">02</span>
                    <h3 className="font-serif text-3xl dark:text-white">Phases</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    {[
                        PhaseEnum.Quote,
                        PhaseEnum.Design_Review,
                        PhaseEnum.Design_Approval,
                        PhaseEnum.Material_Request,
                        PhaseEnum.Production,
                        PhaseEnum.Installation,
                        PhaseEnum.Delivery
                    ].map((phase, i) => (
                        <label key={i} className="cursor-pointer group relative">
                            <input type="checkbox" defaultChecked={phase !== PhaseEnum.Quote} className="peer sr-only" />
                            <div className="p-8 bg-white dark:bg-gray-800 border border-transparent peer-checked:border-primary dark:peer-checked:border-gray-500 hover:shadow-lg transition-all h-full">
                                <div className="w-2 h-2 rounded-full bg-primary mb-6 opacity-0 peer-checked:opacity-100 transition-opacity"></div>
                                <h4 className="font-serif text-lg italic text-gray-400 peer-checked:text-primary dark:peer-checked:text-white transition-colors">{phase}</h4>
                            </div>
                        </label>
                    ))}
                </div>
            </div>

            {/* Financials */}
            <div className="mb-16 bg-white dark:bg-gray-800 p-12 border border-gray-100 dark:border-gray-700 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-surface dark:bg-gray-900" style={{ clipPath: 'polygon(100% 0, 0 0, 100% 100%)' }}></div>
                <div className="flex items-center justify-between mb-12 relative z-10">
                    <div className="flex items-center gap-4">
                        <span className="font-mono text-xs text-gray-400">03</span>
                        <h3 className="font-serif text-3xl dark:text-white">Financials</h3>
                    </div>

                    {/* Billable Toggle */}
                    <div className="flex items-center gap-4 bg-surface dark:bg-gray-900 px-6 py-3 rounded-full border border-gray-100 dark:border-gray-700">
                        <FileText size={16} className={isBillable ? "text-primary dark:text-white" : "text-gray-400"} />
                        <span className="text-[10px] uppercase tracking-widest font-bold text-gray-500 dark:text-gray-300">Billable Project?</span>
                        <button
                            onClick={() => setIsBillable(!isBillable)}
                            className={`w-10 h-5 rounded-full relative transition-colors duration-300 ${isBillable ? 'bg-primary dark:bg-white' : 'bg-gray-300 dark:bg-gray-600'}`}
                        >
                            <div className={`absolute top-1 left-1 w-3 h-3 rounded-full bg-white dark:bg-gray-900 transition-transform duration-300 ${isBillable ? 'translate-x-5' : 'translate-x-0'}`}></div>
                        </button>
                    </div>
                </div>

                {/* Financial Inputs & Output */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12 relative z-10">
                    {/* Cost Input */}
                    <div className="bg-surface dark:bg-gray-900 p-6 border border-gray-100 dark:border-gray-800">
                        <div className="flex items-center gap-2 mb-4 text-gray-400">
                            <DollarSign size={16} />
                            <span className="text-[10px] uppercase tracking-widest font-bold">Estimated Cost</span>
                        </div>
                        <input
                            type="number"
                            value={cost || ''}
                            onChange={(e) => handleCostChange(parseFloat(e.target.value) || 0)}
                            placeholder="0.00"
                            className="w-full bg-transparent text-3xl font-mono text-primary dark:text-white focus:outline-none border-b border-transparent focus:border-gray-300 placeholder-gray-300"
                        />
                    </div>

                    {/* Sell Price Input */}
                    <div className="bg-surface dark:bg-gray-900 p-6 border border-gray-100 dark:border-gray-800">
                        <div className="flex items-center gap-2 mb-4 text-gray-400">
                            <DollarSign size={16} />
                            <span className="text-[10px] uppercase tracking-widest font-bold">Project Sell Price</span>
                        </div>
                        <input
                            type="number"
                            value={sellPrice || ''}
                            onChange={(e) => handleSellPriceInput(parseFloat(e.target.value) || 0)}
                            placeholder="0.00"
                            className="w-full bg-transparent text-3xl font-mono text-primary dark:text-white focus:outline-none border-b border-transparent focus:border-gray-300 placeholder-gray-300"
                        />
                    </div>

                    {/* Gross Margin Box (Calculated) */}
                    <div className="bg-primary dark:bg-white p-6 shadow-xl transform md:-translate-y-4 md:scale-105 transition-transform group">
                        <div className="flex items-center gap-2 mb-4 text-gray-400 dark:text-gray-500">
                            <Percent size={16} />
                            <span className="text-[10px] uppercase tracking-widest font-bold text-white dark:text-primary">Gross Project Margin</span>
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className="text-4xl font-mono text-white dark:text-primary">
                                {grossMarginPercent.toFixed(1)}%
                            </span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-gray-700 dark:border-gray-200 flex justify-between items-center flex-wrap">
                            <span className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-500">Profit Amount</span>
                            <span className="font-mono text-lg text-secondary whitespace-nowrap">
                                ${grossMarginAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Sliders */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-12 relative z-10">
                    <div>
                        <div className="flex justify-between items-baseline mb-4">
                            <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Design Contingency</label>
                            <span className="font-serif text-4xl dark:text-white">{contingency}%</span>
                        </div>
                        <input
                            type="range" min="0" max="20" value={contingency}
                            onChange={(e) => handleContingencyChange(parseInt(e.target.value))}
                            className="w-full h-[2px] bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="flex justify-between text-[10px] text-gray-300 mt-2 font-mono">
                            <span>SAFE (0%)</span>
                            <span>RISKY (20%)</span>
                        </div>
                        <p className="mt-4 text-[10px] text-gray-400 leading-relaxed">
                            Adjusting contingency recalculates the recommended <strong>Sell Price</strong> to maintain your profit margin target against the effective cost.
                        </p>
                    </div>
                    <div>
                        <div className="flex justify-between items-baseline mb-4">
                            <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Profit Margin Target</label>
                            <span className="font-serif text-4xl dark:text-white">{marginTarget}%</span>
                        </div>
                        <input
                            type="range" min="0" max="80" value={marginTarget}
                            onChange={(e) => handleMarginTargetChange(parseInt(e.target.value))}
                            className="w-full h-[2px] bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="flex justify-between text-[10px] text-gray-300 mt-2 font-mono">
                            <span>LOW MARGIN</span>
                            <span>HIGH MARGIN</span>
                        </div>
                        <p className="mt-4 text-[10px] text-gray-400 leading-relaxed">
                            Setting a target margin automatically adjusts the <strong>Project Sell Price</strong> to achieve the desired percentage based on cost + contingency.
                        </p>
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-6 pt-8 border-t border-gray-200 dark:border-gray-700">
                <button
                    onClick={onCancel}
                    className="px-8 py-4 font-mono text-[10px] uppercase tracking-widest text-gray-500 hover:text-primary dark:text-gray-400 dark:hover:text-white transition-colors"
                >
                    Cancel
                </button>
                <button
                    onClick={handleCreate} disabled={saving}
                    className="px-12 py-4 bg-primary text-white dark:bg-white dark:text-primary font-mono text-[10px] uppercase tracking-widest hover:bg-black dark:hover:bg-gray-200 transition-colors flex items-center gap-2 group disabled:opacity-50"
                >
                    {saving ? 'Creating...' : 'Create Project'}
                    <span className="material-icons text-sm group-hover:translate-x-1 transition-transform">arrow_forward</span>
                </button>
            </div>
        </div>
    );
};

export default ProjectInitialization;