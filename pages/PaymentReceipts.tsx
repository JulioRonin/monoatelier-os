import React, { useState, useEffect, useCallback } from 'react';
import {
    facturapiListInvoices,
    facturapiCreateCustomer,
    facturapiCreatePaymentComplement,
    facturapiDownloadPdf,
    facturapiDownloadXml,
    triggerBlobDownload,
    type FacturapiInvoiceRecord,
} from '../lib/facturapi';
import {
    Search, Check, AlertCircle, CheckCircle, Loader, Download,
    ReceiptText, RefreshCw, ChevronLeft, ChevronRight, XCircle, CreditCard,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const IVA_RATE = 0.08;

const PAYMENT_FORMS: { value: string; label: string }[] = [
    { value: '01', label: '01 – Efectivo' },
    { value: '02', label: '02 – Cheque nominativo' },
    { value: '03', label: '03 – Transferencia electrónica' },
    { value: '04', label: '04 – Tarjeta de crédito' },
    { value: '05', label: '05 – Monedero electrónico' },
    { value: '06', label: '06 – Dinero electrónico' },
    { value: '08', label: '08 – Vales de despensa' },
    { value: '12', label: '12 – Dación en pago' },
    { value: '13', label: '13 – Pago por subrogación' },
    { value: '14', label: '14 – Pago por consignación' },
    { value: '15', label: '15 – Condonación' },
    { value: '17', label: '17 – Compensación' },
    { value: '23', label: '23 – Novación' },
    { value: '24', label: '24 – Confusión' },
    { value: '25', label: '25 – Remisión de deuda' },
    { value: '26', label: '26 – Prescripción o caducidad' },
    { value: '27', label: '27 – A satisfacción del acreedor' },
    { value: '28', label: '28 – Tarjeta de débito' },
    { value: '29', label: '29 – Tarjeta de servicios' },
    { value: '30', label: '30 – Aplicación de anticipos' },
    { value: '31', label: '31 – Intermediario pagos' },
    { value: '99', label: '99 – Por definir' },
];

// ---------------------------------------------------------------------------
// Timbrado flow types
// ---------------------------------------------------------------------------
type TimbradoStep = 'idle' | 'customer' | 'rep' | 'download' | 'done' | 'error';

const STEPS: { key: TimbradoStep; label: string }[] = [
    { key: 'customer', label: 'Sincronizando cliente con SAT' },
    { key: 'rep',      label: 'Timbrando Complemento de Pago' },
    { key: 'download', label: 'Descargando PDF y XML' },
    { key: 'done',     label: 'REP completado' },
];

function StepIndicator({ current }: { current: TimbradoStep }) {
    const keys = STEPS.map(s => s.key);
    const idx = keys.indexOf(current);
    return (
        <div className="space-y-3">
            {STEPS.map((step, i) => {
                const done = idx > i || current === 'done';
                const active = step.key === current;
                return (
                    <div key={step.key} className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${done ? 'bg-green-500' : active ? 'bg-primary animate-pulse' : 'bg-gray-200 dark:bg-gray-700'}`}>
                            {done ? <Check size={12} className="text-white" /> : active ? <Loader size={12} className="text-white animate-spin" /> : <span className="text-[10px] text-gray-400">{i + 1}</span>}
                        </div>
                        <span className={`text-sm ${done ? 'text-green-600 dark:text-green-400 line-through' : active ? 'text-primary font-bold' : 'text-gray-400 opacity-50'}`}>{step.label}</span>
                    </div>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
const PaymentReceipts: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'emitir' | 'historial'>('emitir');

    // ── Form state ──────────────────────────────────────────────────────────
    const [ppdinvoices, setPpdInvoices] = useState<FacturapiInvoiceRecord[]>([]);
    const [loadingPpd, setLoadingPpd] = useState(false);
    const [invoiceSearch, setInvoiceSearch] = useState('');
    const [showInvoiceDrop, setShowInvoiceDrop] = useState(false);
    const [selectedInvoice, setSelectedInvoice] = useState<FacturapiInvoiceRecord | null>(null);

    const today = new Date().toISOString().slice(0, 16); // datetime-local format
    const [paymentDate, setPaymentDate] = useState(today);
    const [paymentForm, setPaymentForm] = useState('03');
    const [currency, setCurrency] = useState('MXN');
    const [exchange, setExchange] = useState(1);
    const [amountPaid, setAmountPaid] = useState(0);
    const [installment, setInstallment] = useState(1);
    const [lastBalance, setLastBalance] = useState(0);

    // Calculated IVA on the paid amount
    // Total paid = subtotal + IVA  →  subtotal = amount / 1.08
    const baseGravable = amountPaid / (1 + IVA_RATE);
    const ivaPagado = amountPaid - baseGravable;

    // ── Timbrado state ───────────────────────────────────────────────────────
    const [timbradoStep, setTimbradoStep] = useState<TimbradoStep>('idle');
    const [timbradoError, setTimbradoError] = useState<string | null>(null);
    const [repResult, setRepResult] = useState<{ uuid: string; folio: number; series: string } | null>(null);
    const [errors, setErrors] = useState<{ [k: string]: string }>({});

    // ── Historial state ──────────────────────────────────────────────────────
    const [histList, setHistList] = useState<FacturapiInvoiceRecord[]>([]);
    const [histLoading, setHistLoading] = useState(false);
    const [histError, setHistError] = useState<string | null>(null);
    const [histSearch, setHistSearch] = useState('');
    const [histPage, setHistPage] = useState(1);
    const [histTotalPages, setHistTotalPages] = useState(1);
    const [histTotal, setHistTotal] = useState(0);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);

    // ── Load PPD invoices ────────────────────────────────────────────────────
    const loadPpdInvoices = useCallback(async (q = '') => {
        setLoadingPpd(true);
        try {
            const res = await facturapiListInvoices({ limit: 50, status: 'valid', q: q || undefined });
            // Filter to PPD only
            setPpdInvoices(res.data.filter(inv => inv.payment_method === 'PPD'));
        } catch { /* silent */ }
        finally { setLoadingPpd(false); }
    }, []);

    useEffect(() => { loadPpdInvoices(); }, [loadPpdInvoices]);

    // Debounce search
    useEffect(() => {
        const t = setTimeout(() => loadPpdInvoices(invoiceSearch), 400);
        return () => clearTimeout(t);
    }, [invoiceSearch, loadPpdInvoices]);

    // When invoice selected, auto-fill amount and last_balance from invoice total
    const handleSelectInvoice = (inv: FacturapiInvoiceRecord) => {
        setSelectedInvoice(inv);
        setAmountPaid(inv.total);
        setLastBalance(inv.total);
        setShowInvoiceDrop(false);
        setInvoiceSearch(`${inv.series}${inv.folio_number} – ${inv.customer?.legal_name}`);
    };

    // ── Load historial REP ───────────────────────────────────────────────────
    const loadHistorial = useCallback(async () => {
        setHistLoading(true);
        setHistError(null);
        try {
            const res = await facturapiListInvoices({ limit: 20, page: histPage, q: histSearch || undefined });
            // Facturapi doesn't filter by type in GET invoices easily; filter client-side
            const reps = res.data.filter(inv => inv.type === 'P');
            setHistList(reps);
            setHistTotalPages(res.total_pages);
            setHistTotal(res.total_results);
        } catch (e: any) { setHistError(e.message); }
        finally { setHistLoading(false); }
    }, [histPage, histSearch]);

    useEffect(() => { if (activeTab === 'historial') loadHistorial(); }, [activeTab, loadHistorial]);

    // ── Validation ───────────────────────────────────────────────────────────
    const validate = () => {
        const e: { [k: string]: string } = {};
        if (!selectedInvoice) e.invoice = 'Selecciona una factura PPD';
        if (amountPaid <= 0) e.amount = 'El monto pagado debe ser mayor a 0';
        if (lastBalance <= 0) e.lastBalance = 'El saldo anterior debe ser mayor a 0';
        if (amountPaid > lastBalance) e.amount = 'El monto no puede ser mayor al saldo anterior';
        if (installment <= 0) e.installment = 'El número de parcialidad debe ser mayor a 0';
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    // ── Timbrar REP ──────────────────────────────────────────────────────────
    const handleTimbrar = async () => {
        if (!validate() || !selectedInvoice) return;
        setTimbradoError(null);
        setRepResult(null);
        setTimbradoStep('customer');

        try {
            // Step 1: sync customer
            const customerId = await facturapiCreateCustomer({
                legal_name: selectedInvoice.customer.legal_name,
                tax_id: selectedInvoice.customer.tax_id,
                tax_system: '616', // default; Facturapi will use existing record if already created
                address: { zip: '06600' }, // placeholder — Facturapi uses existing customer data
            });

            // Step 2: build REP payload
            setTimbradoStep('rep');
            const stamped = await facturapiCreatePaymentComplement({
                customer: customerId,
                series: 'P',
                payments: [{
                    date: new Date(paymentDate).toISOString(),
                    payment_form: paymentForm,
                    currency,
                    exchange: currency !== 'MXN' ? exchange : undefined,
                    amount: amountPaid,
                    related_documents: [{
                        uuid: selectedInvoice.uuid,
                        amount: amountPaid,
                        installment,
                        last_balance: lastBalance,
                        taxes_paid: [{
                            base: parseFloat(baseGravable.toFixed(6)),
                            type: 'IVA',
                            rate: IVA_RATE,
                            amount: parseFloat(ivaPagado.toFixed(6)),
                        }],
                    }],
                }],
            });

            // Step 3: download
            setTimbradoStep('download');
            try {
                const pdf = await facturapiDownloadPdf(stamped.id);
                triggerBlobDownload(pdf, `REP-${stamped.uuid}.pdf`);
            } catch (e) { console.warn('PDF download failed', e); }

            await new Promise(r => setTimeout(r, 800));

            try {
                const xml = await facturapiDownloadXml(stamped.id);
                triggerBlobDownload(xml, `REP-${stamped.uuid}.xml`);
            } catch (e) { console.warn('XML download failed', e); }

            setRepResult({ uuid: stamped.uuid, folio: stamped.folio_number, series: stamped.series || 'P' });
            setTimbradoStep('done');

        } catch (err: any) {
            setTimbradoError(err.message || 'Error inesperado');
            setTimbradoStep('error');
        }
    };

    const resetForm = () => {
        setTimbradoStep('idle'); setTimbradoError(null); setRepResult(null);
        setSelectedInvoice(null); setInvoiceSearch(''); setAmountPaid(0);
        setLastBalance(0); setInstallment(1); setErrors({});
    };

    // ── Download helpers ─────────────────────────────────────────────────────
    const handleDownloadPdf = async (inv: FacturapiInvoiceRecord) => {
        setDownloadingId(inv.id + '-pdf');
        try { const b = await facturapiDownloadPdf(inv.id); triggerBlobDownload(b, `REP-${inv.uuid}.pdf`); }
        catch (e: any) { alert('Error descargando PDF: ' + e.message); }
        finally { setDownloadingId(null); }
    };
    const handleDownloadXml = async (inv: FacturapiInvoiceRecord) => {
        setDownloadingId(inv.id + '-xml');
        try { const b = await facturapiDownloadXml(inv.id); triggerBlobDownload(b, `REP-${inv.uuid}.xml`); }
        catch (e: any) { alert('Error descargando XML: ' + e.message); }
        finally { setDownloadingId(null); }
    };

    const filteredPpd = ppdinvoices.filter(inv =>
        !invoiceSearch || invoiceSearch.toLowerCase().split('–')[1]?.trim()
            ? inv.customer?.legal_name?.toLowerCase().includes(invoiceSearch.toLowerCase())
            : true
    );

    // ── Timbrado overlay ────────────────────────────────────────────────────
    if (timbradoStep !== 'idle') {
        return (
            <div className="max-w-7xl mx-auto animate-fade-in">
                <div className="border-b border-gray-200 dark:border-gray-700 pb-6 mb-8">
                    <h1 className="font-serif text-4xl dark:text-white text-primary mb-2">Complemento de Pago</h1>
                    <p className="text-xs font-mono uppercase tracking-widest text-gray-400">Recibo Electrónico de Pago — CFDI 4.0</p>
                </div>
                <div className="max-w-md mx-auto">
                    {timbradoStep === 'error' && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-8 text-center space-y-4">
                            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto"><AlertCircle size={32} className="text-red-500" /></div>
                            <h2 className="font-serif text-2xl text-red-700 dark:text-red-400">Error al Timbrar REP</h2>
                            <p className="text-sm text-red-600 dark:text-red-300 bg-red-100 dark:bg-red-900/40 rounded-lg p-4 font-mono text-left leading-relaxed">{timbradoError}</p>
                            <button onClick={() => { setTimbradoStep('idle'); setTimbradoError(null); }} className="w-full py-3 bg-primary text-white text-xs font-bold uppercase tracking-widest rounded-lg hover:bg-black transition-colors">
                                Corregir e intentar de nuevo
                            </button>
                        </div>
                    )}
                    {timbradoStep === 'done' && repResult && (
                        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-8 text-center space-y-6 shadow-xl">
                            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto"><CheckCircle size={32} className="text-green-500" /></div>
                            <div>
                                <h2 className="font-serif text-2xl text-primary dark:text-white mb-1">¡REP Timbrado!</h2>
                                <p className="text-xs text-gray-400 uppercase tracking-widest">Complemento de Pago CFDI 4.0 válido</p>
                            </div>
                            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-left space-y-3">
                                <div>
                                    <p className="text-[10px] uppercase tracking-widest text-gray-400">Folio Fiscal (UUID)</p>
                                    <p className="font-mono text-xs text-gray-800 dark:text-gray-200 break-all mt-1">{repResult.uuid}</p>
                                </div>
                                <div className="flex gap-6">
                                    <div><p className="text-[10px] uppercase tracking-widest text-gray-400">Serie</p><p className="font-mono text-sm">{repResult.series}</p></div>
                                    <div><p className="text-[10px] uppercase tracking-widest text-gray-400">Folio</p><p className="font-mono text-sm">{repResult.folio}</p></div>
                                    <div><p className="text-[10px] uppercase tracking-widest text-gray-400">Monto pagado</p><p className="font-mono text-sm">${amountPaid.toLocaleString('es-MX', { minimumFractionDigits: 2 })} {currency}</p></div>
                                </div>
                            </div>
                            <div className="flex items-center justify-center gap-2 text-xs text-gray-400"><Download size={12} /> PDF y XML descargados automáticamente</div>
                            <button onClick={resetForm} className="w-full py-3 bg-primary text-white text-xs font-bold uppercase tracking-widest rounded-lg hover:bg-black transition-colors">Emitir otro REP</button>
                        </div>
                    )}
                    {timbradoStep !== 'error' && timbradoStep !== 'done' && (
                        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-8 shadow-xl space-y-6">
                            <div className="text-center">
                                <h2 className="font-serif text-2xl text-primary dark:text-white mb-1">Procesando REP</h2>
                                <p className="text-xs text-gray-400 uppercase tracking-widest">Por favor espera...</p>
                            </div>
                            <StepIndicator current={timbradoStep} />
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Main UI ─────────────────────────────────────────────────────────────
    return (
        <div className="max-w-7xl mx-auto space-y-8 pb-12 animate-fade-in">
            {/* Header + Tabs */}
            <div className="border-b border-gray-200 dark:border-gray-700 pb-0">
                <div className="flex justify-between items-start pb-4">
                    <div>
                        <h1 className="font-serif text-4xl dark:text-white text-primary mb-2">Complemento de Pago</h1>
                        <p className="text-xs font-mono uppercase tracking-widest text-gray-400">Recibo Electrónico de Pago (REP) — CFDI 4.0</p>
                    </div>
                    {activeTab === 'emitir' && (
                        <button onClick={handleTimbrar} className="flex items-center gap-2 px-6 py-3 bg-primary text-white text-xs uppercase tracking-widest font-bold shadow-lg hover:bg-primary/90 transition-colors rounded-lg">
                            <Check size={16} /> Timbrar REP
                        </button>
                    )}
                    {activeTab === 'historial' && (
                        <button onClick={loadHistorial} disabled={histLoading} className="flex items-center gap-2 px-5 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs uppercase tracking-widest font-bold text-gray-500 hover:text-primary rounded-lg transition-colors">
                            <RefreshCw size={14} className={histLoading ? 'animate-spin' : ''} /> Actualizar
                        </button>
                    )}
                </div>
                <div className="flex">
                    <button onClick={() => setActiveTab('emitir')} className={`flex items-center gap-2 px-6 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors ${activeTab === 'emitir' ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                        <CreditCard size={14} /> Emitir REP
                    </button>
                    <button onClick={() => setActiveTab('historial')} className={`flex items-center gap-2 px-6 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors ${activeTab === 'historial' ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                        <ReceiptText size={14} /> Historial REP
                    </button>
                </div>
            </div>

            {/* ── Emitir REP Tab ────────────────────────────────────────── */}
            {activeTab === 'emitir' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Left: Factura PPD + Payment */}
                    <div className="space-y-6">
                        {/* Select PPD Invoice */}
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-5 flex items-center gap-2">
                                <Search size={15} /> Factura PPD a liquidar
                            </h3>
                            <div className="relative">
                                <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
                                    Buscar factura <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={invoiceSearch}
                                    onChange={e => { setInvoiceSearch(e.target.value); setShowInvoiceDrop(true); setSelectedInvoice(null); }}
                                    onFocus={() => setShowInvoiceDrop(true)}
                                    placeholder="Buscar por folio, cliente o RFC..."
                                    className={`w-full bg-gray-50 dark:bg-gray-900 border ${errors.invoice ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'} rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors`}
                                />
                                {errors.invoice && <p className="text-[10px] text-red-500 mt-1">{errors.invoice}</p>}

                                {showInvoiceDrop && (
                                    <div className="absolute z-10 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 mt-1 rounded-xl shadow-2xl max-h-72 overflow-y-auto">
                                        {loadingPpd && (
                                            <div className="flex items-center gap-2 px-4 py-3 text-xs text-gray-400">
                                                <Loader size={12} className="animate-spin" /> Cargando facturas PPD...
                                            </div>
                                        )}
                                        {!loadingPpd && ppdinvoices.length === 0 && (
                                            <div className="px-4 py-4 text-xs text-gray-400 text-center italic">
                                                No hay facturas PPD válidas
                                            </div>
                                        )}
                                        {!loadingPpd && ppdinvoices.map(inv => (
                                            <div key={inv.id} onClick={() => handleSelectInvoice(inv)} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-50 dark:border-gray-700 last:border-0">
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <span className="font-mono font-bold text-primary text-sm">{inv.series}{inv.folio_number}</span>
                                                        <span className="ml-2 text-xs text-gray-400">{new Date(inv.created_at).toLocaleDateString('es-MX')}</span>
                                                    </div>
                                                    <span className="font-mono text-sm font-bold">${inv.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                                </div>
                                                <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{inv.customer?.legal_name}</p>
                                                <p className="font-mono text-[10px] text-gray-400">{inv.customer?.tax_id} · UUID: {inv.uuid?.slice(0, 16)}…</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Selected invoice summary */}
                            {selectedInvoice && (
                                <div className="mt-4 p-4 bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-lg space-y-2">
                                    <p className="text-[10px] uppercase tracking-widest text-primary font-bold">Factura Seleccionada</p>
                                    <div className="grid grid-cols-2 gap-3 text-xs">
                                        <div><span className="text-gray-400">Cliente</span><p className="font-medium">{selectedInvoice.customer.legal_name}</p></div>
                                        <div><span className="text-gray-400">RFC</span><p className="font-mono">{selectedInvoice.customer.tax_id}</p></div>
                                        <div><span className="text-gray-400">Folio</span><p className="font-mono font-bold">{selectedInvoice.series}{selectedInvoice.folio_number}</p></div>
                                        <div><span className="text-gray-400">Total factura</span><p className="font-mono font-bold text-primary">${selectedInvoice.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</p></div>
                                    </div>
                                    <p className="font-mono text-[9px] text-gray-400 break-all">UUID: {selectedInvoice.uuid}</p>
                                </div>
                            )}
                        </div>

                        {/* Payment Details */}
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-5 flex items-center gap-2">
                                <CreditCard size={15} /> Datos del Pago
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Fecha y Hora del Pago <span className="text-red-500">*</span></label>
                                    <input type="datetime-local" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors" />
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Forma de Pago <span className="text-red-500">*</span></label>
                                    <select value={paymentForm} onChange={e => setPaymentForm(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors">
                                        {PAYMENT_FORMS.map(pf => <option key={pf.value} value={pf.value}>{pf.label}</option>)}
                                    </select>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Moneda</label>
                                        <select value={currency} onChange={e => setCurrency(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors">
                                            <option value="MXN">MXN – Peso mexicano</option>
                                            <option value="USD">USD – Dólar americano</option>
                                            <option value="EUR">EUR – Euro</option>
                                        </select>
                                    </div>
                                    {currency !== 'MXN' && (
                                        <div>
                                            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Tipo de Cambio</label>
                                            <input type="number" value={exchange} onChange={e => setExchange(parseFloat(e.target.value))} step="0.01" className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right: Document details + Summary */}
                    <div className="space-y-6">
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-5">Documento Relacionado</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
                                        Monto Pagado ({currency}) <span className="text-red-500">*</span>
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">$</span>
                                        <input
                                            type="number"
                                            value={amountPaid || ''}
                                            onChange={e => setAmountPaid(parseFloat(e.target.value) || 0)}
                                            step="0.01"
                                            className={`w-full pl-8 bg-gray-50 dark:bg-gray-900 border ${errors.amount ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'} rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors`}
                                        />
                                    </div>
                                    {errors.amount && <p className="text-[10px] text-red-500 mt-1">{errors.amount}</p>}
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
                                        Saldo Anterior de la Factura <span className="text-red-500">*</span>
                                    </label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">$</span>
                                        <input
                                            type="number"
                                            value={lastBalance || ''}
                                            onChange={e => setLastBalance(parseFloat(e.target.value) || 0)}
                                            step="0.01"
                                            className={`w-full pl-8 bg-gray-50 dark:bg-gray-900 border ${errors.lastBalance ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'} rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors`}
                                        />
                                    </div>
                                    {errors.lastBalance && <p className="text-[10px] text-red-500 mt-1">{errors.lastBalance}</p>}
                                    <p className="text-[9px] text-gray-400 mt-1">Para la primera parcialidad, es el total de la factura original.</p>
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
                                        Número de Parcialidad <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="number"
                                        value={installment}
                                        onChange={e => setInstallment(parseInt(e.target.value) || 1)}
                                        min="1"
                                        className={`w-full bg-gray-50 dark:bg-gray-900 border ${errors.installment ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'} rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors`}
                                    />
                                    {errors.installment && <p className="text-[10px] text-red-500 mt-1">{errors.installment}</p>}
                                </div>
                            </div>
                        </div>

                        {/* Tax breakdown */}
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-5">Resumen del Pago</h3>
                            <div className="space-y-3">
                                <div className="flex justify-between text-sm text-gray-500">
                                    <span>Monto Total del Pago</span>
                                    <span className="font-mono font-bold">${amountPaid.toLocaleString('es-MX', { minimumFractionDigits: 2 })} {currency}</span>
                                </div>
                                <div className="flex justify-between text-sm text-gray-500">
                                    <span>Base Gravable (excl. IVA 8%)</span>
                                    <span className="font-mono">${baseGravable.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                </div>
                                <div className="flex justify-between text-sm text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-3">
                                    <span>IVA Trasladado (8%)</span>
                                    <span className="font-mono text-green-600">+${ivaPagado.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                </div>
                                <div className="flex justify-between text-sm text-gray-500">
                                    <span>Número de parcialidad</span>
                                    <span className="font-mono font-bold">{installment}</span>
                                </div>
                                <div className="flex justify-between text-sm text-gray-500">
                                    <span>Saldo anterior</span>
                                    <span className="font-mono">${lastBalance.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                </div>
                                <div className="flex justify-between text-sm text-gray-500">
                                    <span>Saldo insoluto</span>
                                    <span className="font-mono font-bold text-primary">${Math.max(0, lastBalance - amountPaid).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                </div>
                            </div>

                            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg">
                                <p className="text-[10px] uppercase tracking-widest text-blue-600 dark:text-blue-400 font-bold mb-2">Referencia Factura</p>
                                {selectedInvoice ? (
                                    <p className="font-mono text-xs text-blue-700 dark:text-blue-300 break-all">{selectedInvoice.uuid}</p>
                                ) : (
                                    <p className="text-xs text-blue-500 italic">Selecciona una factura PPD arriba</p>
                                )}
                            </div>

                            <button onClick={handleTimbrar} className="mt-6 w-full flex items-center justify-center gap-2 py-3 bg-primary text-white text-xs uppercase tracking-widest font-bold shadow-lg hover:bg-primary/90 transition-colors rounded-lg">
                                <Check size={16} /> Timbrar Complemento de Pago
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Historial REP Tab ─────────────────────────────────────── */}
            {activeTab === 'historial' && (
                <div className="space-y-6">
                    <div className="flex flex-wrap gap-4 items-center">
                        <div className="relative flex-1 min-w-[220px]">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input type="text" placeholder="Buscar por cliente o RFC..." value={histSearch} onChange={e => { setHistSearch(e.target.value); setHistPage(1); }} className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-primary transition-colors" />
                            {histSearch && <button onClick={() => { setHistSearch(''); setHistPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><XCircle size={14} /></button>}
                        </div>
                    </div>

                    {histError && (
                        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl text-sm text-red-600">
                            <AlertCircle size={16} /><span>{histError}</span>
                        </div>
                    )}

                    {histLoading && <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-[68px] bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />)}</div>}

                    {!histLoading && !histError && (
                        <>
                            {histList.length === 0 ? (
                                <div className="text-center py-20 text-gray-400">
                                    <ReceiptText size={40} className="mx-auto mb-4 opacity-30" />
                                    <p className="text-sm italic">No se encontraron complementos de pago</p>
                                </div>
                            ) : (
                                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden shadow-sm">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-100 dark:border-gray-700 text-[10px] uppercase tracking-widest text-gray-400">
                                                <th className="px-5 py-3 text-left">Folio REP</th>
                                                <th className="px-5 py-3 text-left">Fecha</th>
                                                <th className="px-5 py-3 text-left">Cliente</th>
                                                <th className="px-5 py-3 text-left">RFC</th>
                                                <th className="px-5 py-3 text-right">Monto</th>
                                                <th className="px-5 py-3 text-center">Descargas</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                                            {histList.map(inv => (
                                                <tr key={inv.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors">
                                                    <td className="px-5 py-4"><span className="font-mono font-bold text-primary">{inv.series}{inv.folio_number}</span></td>
                                                    <td className="px-5 py-4 text-gray-500 text-xs">{new Date(inv.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                                                    <td className="px-5 py-4">
                                                        <p className="font-medium text-gray-800 dark:text-gray-200 truncate max-w-[180px]">{inv.customer?.legal_name || '—'}</p>
                                                        {inv.uuid && <p className="font-mono text-[10px] text-gray-400 truncate max-w-[180px]">{inv.uuid}</p>}
                                                    </td>
                                                    <td className="px-5 py-4 font-mono text-xs text-gray-500">{inv.customer?.tax_id || '—'}</td>
                                                    <td className="px-5 py-4 text-right font-mono font-bold">${(inv.total ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                                                    <td className="px-5 py-4">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <button onClick={() => handleDownloadPdf(inv)} disabled={downloadingId === inv.id + '-pdf'} className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition-colors disabled:opacity-50">
                                                                {downloadingId === inv.id + '-pdf' ? <Loader size={10} className="animate-spin" /> : <Download size={10} />} PDF
                                                            </button>
                                                            <button onClick={() => handleDownloadXml(inv)} disabled={downloadingId === inv.id + '-xml'} className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50">
                                                                {downloadingId === inv.id + '-xml' ? <Loader size={10} className="animate-spin" /> : <Download size={10} />} XML
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            {histTotalPages > 1 && (
                                <div className="flex items-center justify-between">
                                    <p className="text-xs text-gray-400">{histTotal} resultados · Página {histPage} de {histTotalPages}</p>
                                    <div className="flex gap-2">
                                        <button onClick={() => setHistPage(p => Math.max(1, p - 1))} disabled={histPage === 1} className="flex items-center gap-1 px-4 py-2 text-xs font-bold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-500 hover:text-primary disabled:opacity-40 transition-colors">
                                            <ChevronLeft size={14} /> Anterior
                                        </button>
                                        <button onClick={() => setHistPage(p => Math.min(histTotalPages, p + 1))} disabled={histPage === histTotalPages} className="flex items-center gap-1 px-4 py-2 text-xs font-bold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-500 hover:text-primary disabled:opacity-40 transition-colors">
                                            Siguiente <ChevronRight size={14} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default PaymentReceipts;
