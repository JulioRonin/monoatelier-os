import React, { useState, useEffect } from 'react';
import { MOCK_QUOTES } from '../constants';
import { Quote, QuoteItem, User } from '../types';
import { Plus, FileText, Printer, Trash2, ArrowLeft, Send, Save, Download, CheckCircle, Loader, Calculator as CalcIcon, ChevronDown, ChevronUp, Shield, Check, X, AlertTriangle, User as UserIcon } from 'lucide-react';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

import { api } from '../lib/api';

interface QuotesProps {
    user?: User | null;
    initialQuoteId?: string | null;
}

const Quotes: React.FC<QuotesProps> = ({ user, initialQuoteId }) => {
    const [quotes, setQuotes] = useState<Quote[]>([]);
    const [view, setView] = useState<'list' | 'create' | 'detail' | 'manage'>('list');
    const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
    const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
    const [clients, setClients] = useState<any[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [loading, setLoading] = useState(true);
    const [formData, setFormData] = useState<Partial<Quote>>({
        items: [{ description: '', quantity: 1, unitPrice: 0 }]
    });

    // Materials Calculator State
    const [showCalculator, setShowCalculator] = useState(false);
    const [services, setServices] = useState<any[]>([]);
    const [variables, setVariables] = useState<any[]>([]);
    const [calcCategory, setCalcCategory] = useState<string>('');
    const [calcService, setCalcService] = useState<any>(null);
    const [calcVariable, setCalcVariable] = useState<any>(null);
    const [calcQuantity, setCalcQuantity] = useState<number>(1);

    useEffect(() => {
        api.getClients().then(setClients).catch(console.error);
        Promise.all([api.getServices(), api.getServiceVariables()])
            .then(([s, v]) => {
                setServices(s);
                setVariables(v);
            })
            .catch(console.error);
    }, []);

    // Initial Fetch
    useEffect(() => {
        loadQuotes();
    }, []);

    const loadQuotes = async () => {
        try {
            setLoading(true);
            const data = await api.getQuotes();
            setQuotes(data);

            // Auto-select if ID provided
            if (initialQuoteId) {
                const found = data.find(q => q.id === initialQuoteId);
                if (found) {
                    setSelectedQuote(found);
                    setView('detail');
                }
            }
        } catch (error: any) {
            console.error(error);
            alert(`Error loading quotes: ${error.message || error}`);
        } finally {
            setLoading(false);
        }
    };

    const createPdfBlob = async (quote: Quote): Promise<string | null> => {
        try {
            // encoding the filename to handle spaces and special characters
            const templateName = 'TEMPLATE Mono Atelier  (1).pdf';
            const existingPdfBytes = await fetch(`/${encodeURIComponent(templateName)}`).then(res => {
                if (!res.ok) throw new Error(`Failed to load template: ${res.statusText}`);
                return res.arrayBuffer();
            });
            const pdfDoc = await PDFDocument.load(existingPdfBytes);
            const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
            const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

            const pages = pdfDoc.getPages();
            // User requested page 2. Index 1.
            const pageIndex = pages.length > 1 ? 1 : 0;
            const targetPage = pages[pageIndex];
            const { height } = targetPage.getSize();

            const fontSize = 10;
            const drawText = (text: string, x: number, yFromTop: number, font = helveticaFont, size = fontSize) => {
                targetPage.drawText(text, {
                    x,
                    y: height - yFromTop,
                    size,
                    font,
                    color: rgb(0.1, 0.1, 0.1),
                });
            };

            // NEW COORDINATES (Refined V7 - Final Polish)
            // Header Info
            drawText(quote.projectName, 220, 195, helveticaBold, 10);
            drawText(quote.clientName, 220, 220, helveticaBold, 10);

            // Date: Moved Left to 450 to be closer to "Fecha:" label
            drawText(quote.date, 450, 220, helveticaFont, 10);

            // Items Table
            let currentY = 300;

            // X Coordinates for alignment
            const qtyCenter = 280; // Kept (Good)
            const priceRight = 415; // Kept (Good)
            const totalRight = 495; // Kept (Good)

            quote.items.forEach(item => {
                const qty = Number(item.quantity) || 0;
                const price = Number(item.unitPrice) || 0;
                const total = qty * price;

                // Description - Kept at 65
                drawText(item.description.substring(0, 60), 65, currentY);

                // Quantity (Centered)
                const qtyText = qty.toString();
                const qtyWidth = helveticaFont.widthOfTextAtSize(qtyText, 10);
                drawText(qtyText, qtyCenter - (qtyWidth / 2), currentY);

                // Unit Price (Right Aligned)
                const priceText = `$${price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                const priceWidth = helveticaFont.widthOfTextAtSize(priceText, 10);
                drawText(priceText, priceRight - priceWidth, currentY);

                // Total (Right Aligned)
                const totalText = `$${total.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                const totalWidth = helveticaFont.widthOfTextAtSize(totalText, 10);
                drawText(totalText, totalRight - totalWidth, currentY);

                currentY += 20;
            });

            // Financials
            const subTotal = quote.totalAmount || 0;
            const iva = subTotal * 0.08;
            const grandTotal = subTotal + iva;

            const financialsRight = 495; // Match Total Right Column
            const startY = 450; // Moved UP slightly (Refined V8)

            // Sub Total
            const subTotalText = `$${subTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const subTotalWidth = helveticaBold.widthOfTextAtSize(subTotalText, 10);
            drawText(subTotalText, financialsRight - subTotalWidth, startY, helveticaBold, 10);

            // IVA (8%)
            const ivaText = `$${iva.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const ivaWidth = helveticaBold.widthOfTextAtSize(ivaText, 10);
            drawText(ivaText, financialsRight - ivaWidth, startY + 15, helveticaBold, 10);

            // Total
            const grandTotalText = `$${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const grandTotalWidth = helveticaBold.widthOfTextAtSize(grandTotalText, 12);
            drawText(grandTotalText, financialsRight - grandTotalWidth, startY + 35, helveticaBold, 12);

            // Notes Section 
            if (quote.notes) {
                // Moved Right to 140, UP to 450
                const notesY = 450;
                drawText(quote.notes.substring(0, 80), 140, notesY, helveticaFont, 8);
            }

            // DELIVERY TIME CALCULATION (Business Days)
            // Template text: "TIEMPO DE ENTREGA __ DÍAS..."
            // "NOTAS" label is around Y=450. 
            // "TIEMPO DE ENTREGA" is below "TÉRMINOS DE PAGO".
            // Estimated Y = 515. Estimated X = 170 (after "TIEMPO DE ENTREGA ")

            const countBusinessDays = (startStr: string, endStr: string) => {
                const start = new Date(startStr);
                const end = new Date(endStr);
                if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
                if (end < start) return 0;

                let count = 0;
                const cur = new Date(start);
                while (cur <= end) {
                    const dayOfWeek = cur.getDay();
                    if (dayOfWeek !== 0 && dayOfWeek !== 6) count++;
                    cur.setDate(cur.getDate() + 1);
                }
                return count;
            };

            const businessDays = countBusinessDays(quote.date, quote.deliveryTime);
            if (businessDays > 0) {
                // Adjusted coordinates to land on "TIEMPO DE ENTREGA __ DÍAS"
                // Moved DOWN to 540 and RIGHT to 210
                drawText(String(businessDays), 210, 540, helveticaBold, 9);
            }

            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
            return URL.createObjectURL(blob);
        } catch (error) {
            console.error('Error generating PDF:', error);
            return null;
        }
    };

    useEffect(() => {
        let active = true;
        setPdfPreviewUrl(null);
        if (view === 'detail' && selectedQuote) {
            setIsGenerating(true);
            createPdfBlob(selectedQuote).then(url => {
                if (active && url) setPdfPreviewUrl(url);
                setIsGenerating(false);
            });
        }
        return () => { active = false; };
    }, [selectedQuote, view]);


    const handleDownload = async () => {
        if (!selectedQuote) return;
        const url = await createPdfBlob(selectedQuote);
        if (url) {
            const link = document.createElement('a');
            link.href = url;
            link.download = `Cotizacion_${selectedQuote.projectName.replace(/\s+/g, '_')}.pdf`;
            link.click();
        }
    };

    const handleApproveAndConvert = async () => {
        if (!selectedQuote) return;

        try {
            // 1. Update quote status
            await api.updateQuote(selectedQuote.id, { status: 'Approved' });

            // 2. Create Project
            await api.createProject({
                name: selectedQuote.projectName,
                clientId: 'client-id-placeholder', // In a real app, we'd link this properly or look it up
                status: 'In Progress', // Use string literal matching ProjectStatus
                budget: selectedQuote.totalAmount,
                liveCost: 0,
                startDate: new Date().toISOString().split('T')[0],
                progress: 0,
                phase: 'Quote', // Initial phase
                priority: 'Medium',
                responsibleId: user?.id // Auto-assign creator
            } as any);

            // 3. Update local state
            const updatedQuotes = quotes.map(q =>
                q.id === selectedQuote.id ? { ...q, status: 'Approved' as const } : q
            );
            setQuotes(updatedQuotes);
            setSelectedQuote({ ...selectedQuote, status: 'Approved' });

            alert(`Quote Approved!\n\nProject "${selectedQuote.projectName}" has been created and assigned to you.`);
        } catch (error) {
            console.error(error);
            alert("Error converting quote to project.");
        }
    };

    // Calculator Logic
    const categories = Array.from(new Set(services.map(s => s.category))).filter(Boolean);
    const filteredServices = calcCategory ? services.filter(s => s.category === calcCategory) : services;
    const currentServiceVariables = calcService ? variables.filter(v => v.service_id === calcService.id) : [];

    // Helper to add from stats
    const handleAddFromCalculator = () => {
        if (!calcService) return;

        const price = (calcVariable && Number(calcVariable.price) > 0)
            ? Number(calcVariable.price)
            : Number(calcService.base_price);

        const description = calcVariable
            ? `${calcService.name} - ${calcVariable.name}`
            : calcService.name;

        // Add item
        setFormData(prev => ({
            ...prev,
            items: [
                ...(prev.items || []),
                { description, quantity: calcQuantity, unitPrice: price }
            ]
        }));

        setCalcQuantity(1);
    };

    // Helper functions
    const handleCreateNew = () => {
        setFormData({ items: [{ description: '', quantity: 1, unitPrice: 0 }], date: new Date().toISOString().split('T')[0], status: 'Draft' });
        setView('create');
    };

    // Edit Functionality
    const handleEdit = () => {
        if (!selectedQuote) return;
        // Deep copy items to avoid reference issues
        setFormData({
            ...selectedQuote,
            items: selectedQuote.items.map(i => ({ ...i }))
        });
        setView('create'); // Reuse create view for editing
    };

    const handleAddItem = () => setFormData(prev => ({ ...prev, items: [...(prev.items || []), { description: '', quantity: 1, unitPrice: 0 }] }));
    const handleRemoveItem = (index: number) => setFormData(prev => ({ ...prev, items: prev.items?.filter((_, i) => i !== index) }));
    const handleItemChange = (index: number, field: keyof QuoteItem, value: string | number) => {
        const newItems = [...(formData.items || [])];
        if (field === 'quantity' || field === 'unitPrice') (newItems[index] as any)[field] = Number(value);
        else (newItems[index] as any)[field] = value;
        setFormData(prev => ({ ...prev, items: newItems }));
    };
    const calculateTotal = (items: QuoteItem[]) => items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

    const handleSave = async () => {
        if (!formData.projectName || !formData.clientName) return;

        const isUpdate = formData.id && formData.id !== 'temp-id';
        const totalAmount = calculateTotal(formData.items || []);

        const quoteData: any = {
            projectName: formData.projectName!,
            clientName: formData.clientName!,
            deliveryTime: formData.deliveryTime || 'TBD',
            date: formData.date || new Date().toISOString().split('T')[0],
            items: formData.items || [],
            notes: formData.notes,
            status: formData.status || 'Draft',
            totalAmount: totalAmount
        };

        try {
            if (isUpdate) {
                await api.updateQuote(formData.id!, quoteData);
            } else {
                await api.createQuote({ ...quoteData, id: 'temp-id' }); // ID handled by DB/API
            }

            await loadQuotes(); // Reload list

            // Set selected to the saved one
            if (isUpdate) {
                const updated = await api.getQuotes().then(qs => qs.find(q => q.id === formData.id));
                if (updated) setSelectedQuote(updated);
            } else {
                const created = await api.getQuotes().then(qs => qs[0]); // Get latest implies sorting by date desc
                if (created) setSelectedQuote(created);
            }
            setView('detail');
        } catch (e: any) {
            console.error("Error saving quote:", e);
            alert(`Error saving quote to database: ${e.message || JSON.stringify(e)}`);
        }
    };

    // Helper for approval flow
    const handleQuickApprove = async (quote: Quote) => {
        if (!confirm(`Approve quota for ${quote.projectName} ($${quote.totalAmount.toLocaleString()})?`)) return;
        try {
            await api.updateQuote(quote.id, { status: 'Approved' });
            alert("Quote Approved successfully!");
            loadQuotes(); // Refresh
        } catch (e) {
            console.error(e);
            alert("Failed to approve");
        }
    };

    const handleQuickReject = async (quote: Quote) => {
        if (!confirm("Reject this quote?")) return;
        try {
            await api.updateQuote(quote.id, { status: 'Rejected' });
            loadQuotes();
        } catch (e) {
            console.error(e);
        }
    };

    const handleRequestApproval = async (quote: Quote) => {
        if (!confirm(`This quote exceeds $25,000. Request approval from Super User?`)) return;
        try {
            await api.updateQuote(quote.id, { status: 'Awaiting Approval' });
            alert("Approval requested successfully!");
            loadQuotes();
            // Update selected locally to reflect status change immediately
            setSelectedQuote({ ...quote, status: 'Awaiting Approval' });
        } catch (e) {
            console.error(e);
            alert("Failed to request approval");
        }
    };

    const handleDelete = async (e: React.MouseEvent, quote: Quote) => {
        e.stopPropagation();
        if (!confirm(`Are you sure you want to delete the quote for ${quote.projectName}? This action cannot be undone.`)) return;
        try {
            await api.deleteQuote(quote.id);
            loadQuotes();
        } catch (error) {
            console.error(error);
            alert("Failed to delete quote");
        }
    };

    return (
        <div className="space-y-8 animate-fade-in pb-12">


            {/* Header */}
            <div className="flex justify-between items-end border-b border-gray-200 dark:border-gray-700 pb-6">
                <div>
                    <h1 className="font-serif text-4xl dark:text-white mb-2">
                        {view === 'list' ? 'Quotes & Proposals' : view === 'manage' ? 'Quote Approvals' : view === 'create' ? (formData.id ? 'Edit Quote' : 'New Quote') : selectedQuote?.projectName}
                    </h1>
                    <p className="text-xs font-mono uppercase tracking-widest text-gray-400">
                        {view === 'list' ? 'Manage your client proposals' : view === 'manage' ? 'Super User Access Required' : view === 'create' ? (formData.id ? `Editing ID: ${formData.id}` : 'Drafting new proposal') : `Quote ID: ${String(selectedQuote?.id || '').toUpperCase()}`}
                    </p>
                </div>

                <div className="flex gap-4">
                    {view === 'list' && (
                        <>
                            {user?.role === 'Super User' && (
                                <button onClick={() => setView('manage')} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 px-6 py-3 text-[10px] uppercase tracking-widest font-bold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2">
                                    <Shield size={16} /> Manage Quotes
                                </button>
                            )}
                            <button onClick={handleCreateNew} className="bg-primary dark:bg-white dark:text-gray-900 text-white px-6 py-3 text-[10px] uppercase tracking-widest font-bold hover:bg-gray-800 transition-colors flex items-center gap-2">
                                <Plus size={16} /> New Quote
                            </button>
                        </>
                    )}
                    {view !== 'list' && (
                        <button onClick={() => setView('list')} className="text-gray-500 hover:text-gray-900 dark:hover:text-white text-[10px] uppercase tracking-widest font-bold flex items-center gap-2">
                            <ArrowLeft size={16} /> Back to List
                        </button>
                    )}
                </div>
            </div>

            {/* List View */}
            {
                view === 'list' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {quotes.map(quote => (
                            <div key={quote.id} onClick={() => { setSelectedQuote(quote); setView('detail'); }} className="bg-white dark:bg-gray-800 p-6 border border-gray-100 dark:border-gray-700 hover:shadow-lg transition-all cursor-pointer group rounded-xl">
                                <div className="flex justify-between items-start mb-4">
                                    <span className={`text-[10px] px-2 py-1 rounded-full uppercase tracking-widest font-bold ${quote.status === 'Sent' ? 'bg-blue-50 text-blue-600' : quote.status === 'Approved' ? 'bg-green-50 text-green-600' : quote.status === 'Rejected' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'}`}>{quote.status}</span>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={(e) => handleDelete(e, quote)}
                                            className="text-gray-300 hover:text-red-500 transition-colors p-1"
                                            title="Delete Quote"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                        <div className="text-gray-300 group-hover:text-primary dark:group-hover:text-white transition-colors"><FileText size={20} /></div>
                                    </div>
                                </div>
                                <h3 className="font-serif text-xl dark:text-white mb-1 group-hover:underline decoration-1 underline-offset-4">{quote.projectName}</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{quote.clientName}</p>
                                <div className="flex justify-between items-end border-t border-gray-100 dark:border-gray-700 pt-4">
                                    <div><p className="text-[10px] text-gray-400 uppercase">Date</p><p className="text-xs dark:text-gray-300">{quote.date}</p></div>
                                    <div className="text-right"><p className="text-[10px] text-gray-400 uppercase">Total</p><p className="font-serif text-lg dark:text-white">${(quote.totalAmount || 0).toLocaleString()}</p></div>
                                </div>
                            </div>
                        ))}
                    </div>
                )
            }

            {/* Manage View (Approvals) */}
            {
                view === 'manage' && (
                    <div className="animate-fade-in">
                        <div className="mb-8 p-6 bg-gradient-to-r from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 rounded-xl border border-orange-200 dark:border-orange-800 flex items-center gap-4">
                            <div className="p-3 bg-white dark:bg-orange-900 rounded-full text-orange-500">
                                <AlertTriangle size={24} />
                            </div>
                            <div>
                                <h2 className="font-bold text-lg text-orange-900 dark:text-orange-200">Approval Required</h2>
                                <p className="text-sm text-orange-800 dark:text-orange-300">Showing quotes above $25,000 pending Super User authorization.</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {quotes.filter(q => (q.totalAmount > 25000 && q.status !== 'Approved' && q.status !== 'Rejected')).length === 0 ? (
                                <div className="col-span-full py-12 text-center text-gray-400">
                                    <CheckCircle size={48} className="mx-auto mb-4 opacity-50" />
                                    <p>All high-value quotes have been processed.</p>
                                </div>
                            ) : (
                                quotes.filter(q => (q.totalAmount > 25000 && q.status !== 'Approved' && q.status !== 'Rejected')).map(quote => (
                                    <div key={quote.id} className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden border border-gray-100 dark:border-gray-700 relative group">
                                        <div className="absolute top-0 left-0 w-2 h-full bg-orange-400"></div>
                                        <div className="p-8">
                                            <div className="flex justify-between items-start mb-6">
                                                <div>
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-orange-500 bg-orange-50 dark:bg-orange-900/30 px-3 py-1 rounded-full mb-3">
                                                        <Shield size={10} /> Needs Approval
                                                    </span>
                                                    <h3 className="font-serif text-2xl dark:text-white mb-1">{quote.projectName}</h3>
                                                    <p className="text-sm text-gray-500">{quote.clientName}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-[10px] uppercase text-gray-400 tracking-widest mb-1">Total Value</p>
                                                    <p className="font-serif text-3xl font-bold text-gray-900 dark:text-white">${quote.totalAmount.toLocaleString()}</p>
                                                </div>
                                            </div>

                                            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 mb-8 flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs">
                                                        JD
                                                    </div>
                                                    <div>
                                                        <p className="text-xs font-bold text-gray-700 dark:text-gray-300">John Doe (Mock)</p>
                                                        <p className="text-[10px] text-indigo-500 uppercase tracking-wider font-bold">Level 2 Architect</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-[10px] text-gray-400">Created</p>
                                                    <p className="text-xs font-medium dark:text-gray-300">{quote.date}</p>
                                                </div>
                                            </div>

                                            <div className="flex gap-4">
                                                <button
                                                    onClick={() => handleQuickReject(quote)}
                                                    className="flex-1 py-4 rounded-xl border-2 border-transparent hover:bg-red-50 hover:border-red-100 text-red-500 uppercase tracking-widest font-bold text-xs flex items-center justify-center gap-2 transition-all"
                                                >
                                                    <X size={16} /> Reject
                                                </button>
                                                <button
                                                    onClick={() => handleQuickApprove(quote)}
                                                    className="flex-1 py-4 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 uppercase tracking-widest font-bold text-xs flex items-center justify-center gap-2 hover:shadow-lg transform hover:-translate-y-1 transition-all"
                                                >
                                                    <Check size={16} /> Approve Quote
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )))}
                        </div>
                    </div>
                )
            }

            {/* Create / Edit View */}
            {
                view === 'create' && (
                    <div className="bg-white dark:bg-gray-800 p-8 border border-gray-100 dark:border-gray-700 rounded-xl max-w-4xl mx-auto shadow-sm w-full">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                            <div><label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">Project Name</label><input type="text" className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none focus:border-primary transition-colors" value={formData.projectName || ''} onChange={e => setFormData({ ...formData, projectName: e.target.value })} /></div>
                            <div>
                                <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">Client Name</label>
                                <select
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none focus:border-primary transition-colors"
                                    value={formData.clientName || ''}
                                    onChange={e => setFormData({ ...formData, clientName: e.target.value })}
                                >
                                    <option value="">Select a Client</option>
                                    {clients.map(c => (
                                        <option key={c.id} value={c.fullName}>{c.fullName}</option>
                                    ))}
                                </select>
                            </div>
                            <div><label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">Date</label><input type="date" className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none focus:border-primary transition-colors" value={formData.date || ''} onChange={e => setFormData({ ...formData, date: e.target.value })} /></div>
                            <div><label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">Delivery Date</label><input type="date" className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none focus:border-primary transition-colors" value={formData.deliveryTime || ''} onChange={e => setFormData({ ...formData, deliveryTime: e.target.value })} /></div>
                        </div>
                        <div className="mb-8">
                            {/* Materials Calculator Toggle */}
                            <div className="mb-6 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                <button
                                    onClick={() => setShowCalculator(!showCalculator)}
                                    className="w-full flex justify-between items-center p-4 bg-gray-50 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                                >
                                    <div className="flex items-center gap-2 text-primary dark:text-white font-serif italic">
                                        <CalcIcon size={18} />
                                        <span>Materials & Services Calculator</span>
                                    </div>
                                    {showCalculator ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </button>

                                {showCalculator && (
                                    <div className="p-6 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 animate-fade-in">
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                                            {/* Category */}
                                            <div>
                                                <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2">Category</label>
                                                <select
                                                    className="w-full p-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm rounded focus:outline-none focus:border-primary"
                                                    value={calcCategory}
                                                    onChange={e => { setCalcCategory(e.target.value); setCalcService(null); setCalcVariable(null); }}
                                                >
                                                    <option value="">All Categories</option>
                                                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                            </div>

                                            {/* Service */}
                                            <div>
                                                <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2">Service</label>
                                                <select
                                                    className="w-full p-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm rounded focus:outline-none focus:border-primary"
                                                    value={calcService?.id || ''}
                                                    onChange={e => {
                                                        const s = services.find(x => x.id === e.target.value);
                                                        setCalcService(s);
                                                        setCalcVariable(null);
                                                    }}
                                                >
                                                    <option value="">Select Service...</option>
                                                    {filteredServices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                                </select>
                                            </div>

                                            {/* Variable / Option */}
                                            <div>
                                                <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2">Option / Variant</label>
                                                <select
                                                    className="w-full p-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm rounded focus:outline-none focus:border-primary disabled:opacity-50"
                                                    value={calcVariable?.id || ''}
                                                    onChange={e => setCalcVariable(currentServiceVariables.find(v => v.id === e.target.value) || null)}
                                                    disabled={!calcService || currentServiceVariables.length === 0}
                                                >
                                                    <option value="">{currentServiceVariables.length > 0 ? 'Select Option...' : 'Standard / None'}</option>
                                                    {currentServiceVariables.map(v => (
                                                        <option key={v.id} value={v.id}>
                                                            {v.name} {Number(v.price) > 0 ? `($${v.price})` : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            {/* Quantity & Add */}
                                            <div className="flex gap-2 items-end">
                                                <div className="w-20">
                                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-2">Qty</label>
                                                    <input
                                                        type="number"
                                                        className="w-full p-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm rounded text-center focus:outline-none focus:border-primary"
                                                        value={calcQuantity}
                                                        onChange={e => setCalcQuantity(Number(e.target.value))}
                                                        min="1"
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleAddFromCalculator}
                                                    disabled={!calcService}
                                                    className="flex-1 bg-secondary text-white p-2 rounded text-xs uppercase font-bold tracking-widest hover:bg-secondary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed h-[38px] flex items-center justify-center gap-2"
                                                >
                                                    <Plus size={14} /> Add Item
                                                </button>
                                            </div>
                                        </div>

                                        {/* Preview Info */}
                                        {calcService && (
                                            <div className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 p-3 rounded flex justify-between items-center">
                                                <span>{calcService.description}</span>
                                                <div className="flex gap-4">
                                                    <span>Base: <strong>${calcService.base_price}</strong></span>
                                                    <span>Unit: <strong>{calcService.units}</strong></span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            <div className="flex justify-between items-center mb-4"><h3 className="font-serif italic text-lg dark:text-gray-200">Scope of Work</h3><button onClick={handleAddItem} className="text-[10px] uppercase font-bold text-primary dark:text-white hover:underline flex items-center gap-1"><Plus size={12} /> Add Item</button></div>
                            <div className="space-y-4">{formData.items?.map((item, index) => (
                                <div key={index} className="flex gap-4 items-start bg-gray-50 dark:bg-gray-900/50 p-4 border border-gray-100 dark:border-gray-700 rounded"><div className="flex-1"><input type="text" className="w-full bg-transparent border-b border-gray-200 dark:border-gray-600 pb-1 text-sm focus:outline-none focus:border-primary mb-2" placeholder="Description" value={item.description} onChange={e => handleItemChange(index, 'description', e.target.value)} /></div><div className="w-20"><input type="number" className="w-full bg-transparent border-b border-gray-200 dark:border-gray-600 pb-1 text-sm text-center focus:outline-none focus:border-primary" placeholder="Qty" value={item.quantity} onChange={e => handleItemChange(index, 'quantity', e.target.value)} /></div><div className="w-32"><input type="number" className="w-full bg-transparent border-b border-gray-200 dark:border-gray-600 pb-1 text-sm text-right focus:outline-none focus:border-primary" placeholder="Price" value={item.unitPrice} onChange={e => handleItemChange(index, 'unitPrice', e.target.value)} /></div><button onClick={() => handleRemoveItem(index)} className="text-gray-400 hover:text-red-500 pt-1"><Trash2 size={16} /></button></div>
                            ))}</div>
                        </div>
                        <div className="mb-8"><label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">Notes & Conditions</label><textarea className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 text-sm focus:outline-none focus:border-primary transition-colors h-32" value={formData.notes || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })}></textarea></div>
                        <div className="flex justify-end gap-4 border-t border-gray-100 dark:border-gray-700 pt-6"><button onClick={() => setView('detail')} className="px-6 py-3 text-[10px] uppercase tracking-widest font-bold text-gray-500 hover:text-gray-900 dark:hover:text-white">Cancel</button><button onClick={handleSave} className="bg-primary dark:bg-white dark:text-gray-900 text-white px-8 py-3 text-[10px] uppercase tracking-widest font-bold hover:bg-gray-800 transition-colors flex items-center gap-2"><Save size={16} /> Save Changes</button></div>
                    </div>
                )
            }

            {/* DETAIL VIEW - FIXED LAYOUT */}
            {
                view === 'detail' && selectedQuote && (
                    <div className="flex flex-col lg:flex-row gap-8 items-start">
                        {/* Left Panel: Actions & Info */}
                        <div className="w-full lg:w-5/12 flex flex-col gap-6">
                            {/* Action Card */}
                            <div className="bg-white dark:bg-gray-800 p-6 border border-gray-100 dark:border-gray-700 rounded-xl shadow-sm">
                                <div className="mb-6">
                                    <div className="flex justify-between items-start">
                                        <span className={`inline-block mb-2 text-[10px] px-2 py-1 rounded-full uppercase tracking-widest font-bold ${selectedQuote.status === 'Sent' ? 'bg-blue-50 text-blue-600' : selectedQuote.status === 'Approved' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>{selectedQuote.status}</span>
                                        <button onClick={handleEdit} className="text-primary hover:text-primary/80 dark:text-gray-300 dark:hover:text-white text-[10px] uppercase font-bold flex items-center gap-1">
                                            Edit Quote
                                        </button>
                                    </div>
                                    <h2 className="font-serif text-2xl text-gray-900 dark:text-white leading-tight mb-1">{selectedQuote.clientName}</h2>
                                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{selectedQuote.projectName}</p>
                                </div>
                                <div className="space-y-3">
                                    <button onClick={handleDownload} className="w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-white py-3 text-[10px] uppercase tracking-widest font-bold hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"><Download size={14} /> Download PDF</button>

                                    {selectedQuote.status === 'Approved' ? (
                                        <div className="w-full bg-green-50 border border-green-100 text-green-800 py-3 text-[10px] uppercase tracking-widest font-bold flex items-center justify-center gap-2 text-center"><CheckCircle size={14} /> Project Created</div>
                                    ) : (
                                        <>
                                            {(user?.role !== 'Super User' && (selectedQuote.totalAmount || 0) > 25000) ? (
                                                selectedQuote.status === 'Awaiting Approval' ? (
                                                    <div className="w-full bg-orange-50 border border-orange-100 text-orange-800 py-3 text-[10px] uppercase tracking-widest font-bold flex items-center justify-center gap-2 text-center">
                                                        <Shield size={14} /> Approval Requested
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => handleRequestApproval(selectedQuote)}
                                                        className="w-full bg-orange-500 text-white py-3 text-[10px] uppercase tracking-widest font-bold hover:bg-orange-600 transition-colors flex items-center justify-center gap-2"
                                                    >
                                                        <Shield size={14} /> Request Approval
                                                    </button>
                                                )
                                            ) : (
                                                <button onClick={handleApproveAndConvert} className="w-full bg-green-600 text-white py-3 text-[10px] uppercase tracking-widest font-bold hover:bg-green-700 transition-colors flex items-center justify-center gap-2"><CheckCircle size={14} /> Approve & Convert</button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Summary Card - NO SCROLL, FULL HEIGHT */}
                            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-100 dark:border-gray-700 h-fit">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4 border-b border-gray-50 dark:border-gray-800 pb-2">Quote Summary</h3>
                                <ul className="space-y-3 mb-6">
                                    {selectedQuote.items.map((item, i) => (
                                        <li key={i} className="flex justify-between text-xs border-b border-gray-50 dark:border-gray-700 pb-2 last:border-0">
                                            <span className="text-gray-600 dark:text-gray-300 pr-2">{item.description} (x{item.quantity})</span>
                                            <span className="font-mono text-gray-900 dark:text-white">${((item.quantity || 0) * (item.unitPrice || 0)).toLocaleString()}</span>
                                        </li>
                                    ))}
                                </ul>
                                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 flex justify-between items-center">
                                    <span className="font-bold text-sm text-gray-900 dark:text-white">Total</span>
                                    <span className="font-serif text-xl text-primary dark:text-white">${(selectedQuote.totalAmount || 0).toLocaleString()}</span>
                                </div>
                            </div>
                        </div>

                        {/* Right Panel: Live PDF Preview */}
                        <div className="w-full lg:w-7/12 bg-gray-200 dark:bg-gray-900 rounded-xl overflow-hidden border border-gray-300 dark:border-gray-700 shadow-inner flex flex-col min-h-[800px]">
                            <div className="bg-white dark:bg-gray-800 p-2 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center px-4 shrink-0">
                                <span className="text-[10px] uppercase tracking-widest font-bold text-gray-500">Document Preview</span>
                                {isGenerating && <span className="flex items-center gap-2 text-[10px] text-gray-400"><Loader size={12} className="animate-spin" /> Generating...</span>}
                            </div>
                            <div className="flex-1 relative bg-gray-500/10">
                                {pdfPreviewUrl ? (
                                    <iframe src={`${pdfPreviewUrl}#toolbar=0&view=FitH`} className="w-full h-full absolute inset-0" title="PDF Preview" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-400"><Loader size={24} className="animate-spin mb-2" /></div>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default Quotes;
