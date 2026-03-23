import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import {
    facturapiCreateCustomer,
    facturapiCreateInvoice,
    facturapiDownloadPdf,
    facturapiDownloadXml,
    facturapiListInvoices,
    triggerBlobDownload,
    type FacturapiInvoiceRecord,
} from '../lib/facturapi';
import { Client, FiscalRegime, PaymentForm, PaymentMethod, CFDIUse } from '../types';
import { Search, Plus, Trash2, FileText, Check, AlertCircle, Download, CheckCircle, Loader, X, Eye, ReceiptText, RefreshCw, ChevronLeft, ChevronRight, XCircle } from 'lucide-react';

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------
const REGIME_DESCRIPTIONS: { [key: string]: string } = {
    '601': 'General de Ley Personas Morales', '603': 'Personas Morales con Fines no Lucrativos',
    '605': 'Sueldos y Salarios e Ingresos Asimilados', '606': 'Arrendamiento',
    '607': 'Régimen de Enajenación o Adquisición de Bienes', '608': 'Demás ingresos',
    '610': 'Residentes en el Extranjero sin Establecimiento', '611': 'Ingresos por Dividendos',
    '612': 'Personas Físicas con Actividades Empresariales', '614': 'Ingresos por intereses',
    '615': 'Régimen de los ingresos por obtención de premios', '616': 'Sin obligaciones fiscales',
    '620': 'Sociedades Cooperativas de Producción', '621': 'Incorporación Fiscal',
    '622': 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras', '623': 'Opcional para Grupos de Sociedades',
    '624': 'Coordinados', '625': 'Actividades Empresariales con ingresos vía Plataformas Tecnológicas',
    '626': 'Régimen Simplificado de Confianza',
};
const CFDI_USE_DESCRIPTIONS: { [key: string]: string } = {
    'G01': 'Adquisición de mercancías', 'G02': 'Devoluciones, descuentos o bonificaciones',
    'G03': 'Gastos en general', 'I01': 'Construcciones', 'I02': 'Mobiliario y equipo de oficina',
    'I03': 'Equipo de transporte', 'I04': 'Equipo de cómputo y accesorios',
    'I05': 'Moldes, matrices y herramental', 'I06': 'Comunicaciones telefónicas',
    'I07': 'Comunicaciones satelitales', 'I08': 'Otra maquinaria y equipo',
    'D01': 'Honorarios médicos y gastos hospitalarios', 'D02': 'Gastos médicos por incapacidad',
    'D03': 'Gastos funerales', 'D04': 'Donativos', 'D05': 'Intereses reales hipotecarios',
    'D06': 'Aportaciones voluntarias al SAR', 'D07': 'Primas por seguros de gastos médicos',
    'D08': 'Gastos de transportación escolar', 'D09': 'Depósitos en cuentas de ahorro',
    'D10': 'Pagos por servicios educativos', 'S01': 'Sin efectos fiscales', 'CP01': 'Pagos', 'CN01': 'Nómina',
};

// Tax rates
const IVA_RATE = 0.08;   // 8%
const ISR_RATE = 0.0125; // 1.25%

// ---------------------------------------------------------------------------
// Timbrado step indicator
// ---------------------------------------------------------------------------
type TimbradoStep = 'idle' | 'customer' | 'invoice' | 'download' | 'done' | 'error';
const STEPS: { key: TimbradoStep; label: string }[] = [
    { key: 'customer', label: 'Sincronizando cliente con SAT' },
    { key: 'invoice',  label: 'Timbrando CFDI ante el PAC' },
    { key: 'download', label: 'Descargando PDF y XML' },
    { key: 'done',     label: 'Factura completada' },
];
function StepIndicator({ current }: { current: TimbradoStep }) {
    const stepKeys = STEPS.map(s => s.key);
    const currentIndex = stepKeys.indexOf(current);
    return (
        <div className="space-y-3">
            {STEPS.map((step, i) => {
                const isDone = currentIndex > i || current === 'done';
                const isActive = step.key === current;
                return (
                    <div key={step.key} className="flex items-center gap-3">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300 ${isDone ? 'bg-green-500' : isActive ? 'bg-primary animate-pulse' : 'bg-gray-200 dark:bg-gray-700'}`}>
                            {isDone ? <Check size={12} className="text-white" /> : isActive ? <Loader size={12} className="text-white animate-spin" /> : <span className="text-[10px] text-gray-400">{i + 1}</span>}
                        </div>
                        <span className={`text-sm ${isDone ? 'text-green-600 dark:text-green-400 line-through' : isActive ? 'text-primary font-bold' : 'text-gray-400 opacity-50'}`}>{step.label}</span>
                    </div>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Invoice Preview Modal
// ---------------------------------------------------------------------------
interface InvoiceItem {
    id: string; productCode: string; unitCode: string;
    description: string; quantity: number; unitPrice: number; includeIsr: boolean;
}
interface PreviewModalProps {
    onClose: () => void;
    fiscalName: string; rfc: string; postalCode: string; selectedRegime: string;
    cfdiUse: string; paymentMethod: string; effectivePaymentForm: string;
    items: InvoiceItem[];
}
function PreviewModal({ onClose, fiscalName, rfc, postalCode, selectedRegime, cfdiUse, paymentMethod, effectivePaymentForm, items }: PreviewModalProps) {
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const totalIva = subtotal * IVA_RATE;
    const totalIsr = items.filter(i => i.includeIsr).reduce((s, i) => s + i.quantity * i.unitPrice * ISR_RATE, 0);
    const total = subtotal + totalIva - totalIsr;
    const today = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                {/* Modal header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                        <Eye size={20} className="text-primary" />
                        <h2 className="font-serif text-2xl text-primary dark:text-white">Vista Previa CFDI</h2>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={20} /></button>
                </div>

                {/* Invoice body */}
                <div className="p-8 space-y-8 font-sans text-gray-800 dark:text-gray-200">
                    {/* Header row */}
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-xs uppercase tracking-widest text-gray-400 mb-1">Emisor</p>
                            <p className="font-bold text-lg">MONO ATELIER</p>
                            <p className="text-sm text-gray-500">CFDI 4.0 – Comprobante de Ingreso</p>
                        </div>
                        <div className="text-right">
                            <div className="inline-block bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg px-4 py-2">
                                <p className="text-[10px] uppercase tracking-widest text-amber-600 dark:text-amber-400">Borrador – Sin valor fiscal</p>
                                <p className="font-mono text-sm font-bold text-amber-700 dark:text-amber-300">SERIE A</p>
                            </div>
                            <p className="text-xs text-gray-400 mt-2">{today}</p>
                        </div>
                    </div>

                    {/* Client data */}
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-5 grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">Receptor</p>
                            <p className="font-bold">{fiscalName || '—'}</p>
                            <p className="font-mono text-sm">{rfc || '—'}</p>
                        </div>
                        <div className="space-y-1">
                            <div className="flex gap-3">
                                <span className="text-[10px] uppercase tracking-widest text-gray-400 w-24">Código Postal</span>
                                <span className="text-sm">{postalCode || '—'}</span>
                            </div>
                            <div className="flex gap-3">
                                <span className="text-[10px] uppercase tracking-widest text-gray-400 w-24">Régimen</span>
                                <span className="text-sm">{selectedRegime || '—'}</span>
                            </div>
                            <div className="flex gap-3">
                                <span className="text-[10px] uppercase tracking-widest text-gray-400 w-24">Uso CFDI</span>
                                <span className="text-sm">{cfdiUse} – {CFDI_USE_DESCRIPTIONS[cfdiUse] || ''}</span>
                            </div>
                            <div className="flex gap-3">
                                <span className="text-[10px] uppercase tracking-widest text-gray-400 w-24">Método Pago</span>
                                <span className="text-sm">{paymentMethod}</span>
                            </div>
                            <div className="flex gap-3">
                                <span className="text-[10px] uppercase tracking-widest text-gray-400 w-24">Forma Pago</span>
                                <span className="text-sm">{effectivePaymentForm}</span>
                            </div>
                        </div>
                    </div>

                    {/* Concepts table */}
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="border-b-2 border-gray-200 dark:border-gray-700 text-[10px] uppercase tracking-widest text-gray-400">
                                <th className="py-2 text-left">Clave</th>
                                <th className="py-2 text-left">Descripción</th>
                                <th className="py-2 text-center">Cant.</th>
                                <th className="py-2 text-right">P. Unit.</th>
                                <th className="py-2 text-center">IVA 8%</th>
                                <th className="py-2 text-center">ISR 1.25%</th>
                                <th className="py-2 text-right">Importe</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                            {items.length === 0 && (
                                <tr><td colSpan={7} className="py-6 text-center text-gray-400 italic">Sin conceptos</td></tr>
                            )}
                            {items.map(item => {
                                const importe = item.quantity * item.unitPrice;
                                return (
                                    <tr key={item.id}>
                                        <td className="py-3 font-mono text-xs text-gray-400">{item.productCode}</td>
                                        <td className="py-3">{item.description || <span className="text-gray-400 italic">Sin descripción</span>}</td>
                                        <td className="py-3 text-center">{item.quantity}</td>
                                        <td className="py-3 text-right font-mono">${item.unitPrice.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                                        <td className="py-3 text-center"><span className="text-green-600 text-xs">✓</span></td>
                                        <td className="py-3 text-center">{item.includeIsr ? <span className="text-orange-500 text-xs">✓</span> : <span className="text-gray-300">–</span>}</td>
                                        <td className="py-3 text-right font-mono font-bold">${importe.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {/* Totals */}
                    <div className="flex justify-end">
                        <div className="w-72 space-y-2">
                            <div className="flex justify-between text-sm text-gray-500">
                                <span>Subtotal</span>
                                <span className="font-mono">${subtotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex justify-between text-sm text-gray-500">
                                <span>IVA Trasladado (8%)</span>
                                <span className="font-mono text-green-600">+${totalIva.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                            </div>
                            {totalIsr > 0 && (
                                <div className="flex justify-between text-sm text-gray-500">
                                    <span>ISR Retenido (1.25%)</span>
                                    <span className="font-mono text-red-500">−${totalIsr.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                </div>
                            )}
                            <div className="flex justify-between text-xl font-serif text-primary dark:text-white pt-3 border-t-2 border-gray-200 dark:border-gray-700 font-bold">
                                <span>Total</span>
                                <span>${total.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-100 dark:border-amber-800">
                        <AlertCircle size={14} />
                        <span>Este es un borrador. La factura fiscal oficial se generará al hacer clic en "Timbrar Factura".</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
const Invoicing: React.FC = () => {
    // Data
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showClientDropdown, setShowClientDropdown] = useState(false);
    const [showPreview, setShowPreview] = useState(false);

    // Invoice Header
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [rfc, setRfc] = useState('');
    const [fiscalName, setFiscalName] = useState('');
    const [postalCode, setPostalCode] = useState('');
    const [selectedRegime, setSelectedRegime] = useState<string>('');
    const [paymentForm, setPaymentForm] = useState<PaymentForm>(PaymentForm.Transferencia);
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.PUE);
    const [cfdiUse, setCfdiUse] = useState<CFDIUse>(CFDIUse.G03);
    const [clientEmail, setClientEmail] = useState('');

    // SAT Rule: PPD forces payment_form to 99
    const effectivePaymentForm = paymentMethod === PaymentMethod.PPD ? '99' : paymentForm;

    // Concepts (with ISR toggle)
    const [items, setItems] = useState<InvoiceItem[]>([]);

    // Timbrado flow
    const [timbradoStep, setTimbradoStep] = useState<TimbradoStep>('idle');
    const [timbradoError, setTimbradoError] = useState<string | null>(null);
    const [invoiceResult, setInvoiceResult] = useState<{ uuid: string; folioNumber: number; series: string } | null>(null);

    // Validation errors
    const [errors, setErrors] = useState<{ [key: string]: string }>({});

    // ── Tab state ─────────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState<'nueva' | 'historial'>('nueva');

    // ── Invoice history state ─────────────────────────────────────────────
    const [historialList, setHistorialList] = useState<FacturapiInvoiceRecord[]>([]);
    const [historialLoading, setHistorialLoading] = useState(false);
    const [historialError, setHistorialError] = useState<string | null>(null);
    const [histSearch, setHistSearch] = useState('');
    const [histStatus, setHistStatus] = useState<'all' | 'valid' | 'canceled' | 'draft'>('all');
    const [histPage, setHistPage] = useState(1);
    const [histTotalPages, setHistTotalPages] = useState(1);
    const [histTotalResults, setHistTotalResults] = useState(0);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);



    const loadClients = async () => {
        try { const data = await api.getClients(); setClients(data); }
        catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const loadInvoices = useCallback(async () => {
        setHistorialLoading(true);
        setHistorialError(null);
        try {
            const result = await facturapiListInvoices({
                limit: 20,
                page: histPage,
                q: histSearch || undefined,
                status: histStatus !== 'all' ? histStatus as 'valid' | 'canceled' | 'draft' : undefined,
            });
            setHistorialList(result.data);
            setHistTotalPages(result.total_pages);
            setHistTotalResults(result.total_results);
        } catch (e: any) {
            setHistorialError(e.message);
        } finally {
            setHistorialLoading(false);
        }
    }, [histPage, histSearch, histStatus]);

    useEffect(() => { loadClients(); }, []);
    useEffect(() => { if (activeTab === 'historial') loadInvoices(); }, [activeTab, loadInvoices]);

    const handleDownloadPdf = async (inv: FacturapiInvoiceRecord) => {
        setDownloadingId(inv.id + '-pdf');
        try {
            const blob = await facturapiDownloadPdf(inv.id);
            triggerBlobDownload(blob, `factura-${inv.uuid || inv.folio_number}.pdf`);
        } catch (e: any) { alert('Error descargando PDF: ' + e.message); }
        finally { setDownloadingId(null); }
    };

    const handleDownloadXml = async (inv: FacturapiInvoiceRecord) => {
        setDownloadingId(inv.id + '-xml');
        try {
            const blob = await facturapiDownloadXml(inv.id);
            triggerBlobDownload(blob, `factura-${inv.uuid || inv.folio_number}.xml`);
        } catch (e: any) { alert('Error descargando XML: ' + e.message); }
        finally { setDownloadingId(null); }
    };


    const handleSelectClient = (client: Client) => {
        setSelectedClient(client);
        setRfc(client.rfc || '');
        setFiscalName(client.fiscalName || client.fullName.toUpperCase());
        setPostalCode(client.postalCode || '');
        setSelectedRegime(client.fiscalRegime || '');
        setClientEmail(client.email || '');
        setShowClientDropdown(false);
        setSearchTerm(client.fullName);
    };

    const addItem = () => {
        setItems([...items, { id: Date.now().toString(), productCode: '84111506', unitCode: 'E48', description: '', quantity: 1, unitPrice: 0, includeIsr: false }]);
    };
    const updateItem = (index: number, field: string, value: any) => {
        const n = [...items]; n[index] = { ...n[index], [field]: value }; setItems(n);
    };
    const removeItem = (index: number) => setItems(items.filter((_, i) => i !== index));

    const calculateTotals = () => {
        const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        const totalIva = subtotal * IVA_RATE;
        const totalIsr = items.filter(i => i.includeIsr).reduce((s, i) => s + i.quantity * i.unitPrice * ISR_RATE, 0);
        return { subtotal, totalIva, totalIsr, total: subtotal + totalIva - totalIsr };
    };
    const { subtotal, totalIva, totalIsr, total } = calculateTotals();

    const filteredClients = clients.filter(c =>
        c.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.rfc && c.rfc.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const validateForm = () => {
        const e: { [key: string]: string } = {};
        if (!rfc) e.rfc = 'El RFC es requerido';
        else if (!/^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/.test(rfc)) e.rfc = 'Formato de RFC inválido';
        if (!fiscalName) e.fiscalName = 'La Razón Social es requerida';
        if (!postalCode) e.postalCode = 'El Código Postal es requerido';
        if (!selectedRegime) e.selectedRegime = 'El Régimen Fiscal es requerido';
        if (items.length === 0) e.items = 'Debe agregar al menos un concepto';
        items.forEach((item, index) => {
            if (item.quantity <= 0) e[`item_${index}_qty`] = 'Cantidad inválida';
            if (item.unitPrice < 0) e[`item_${index}_price`] = 'Precio inválido';
            if (!item.description) e[`item_${index}_desc`] = 'Descripción requerida';
        });
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handlePreview = () => {
        setErrors({});
        setShowPreview(true);
    };

    const handleTimbrar = async () => {
        if (!validateForm()) return;
        setTimbradoError(null);
        setInvoiceResult(null);
        setTimbradoStep('customer');

        try {
            // Step 1: Sync customer
            const customerId = await facturapiCreateCustomer({
                legal_name: fiscalName,
                tax_id: rfc,
                tax_system: selectedRegime,
                address: { zip: postalCode },
                email: clientEmail || undefined,
            });

            // Step 2: Build invoice payload
            setTimbradoStep('invoice');
            const facturapiItems = items.map(item => {
                const taxes: { type: 'IVA' | 'ISR'; rate: number; withholding?: boolean }[] = [
                    { type: 'IVA', rate: IVA_RATE },
                ];
                if (item.includeIsr) {
                    taxes.push({ type: 'ISR', rate: ISR_RATE, withholding: true });
                }
                return {
                    quantity: item.quantity,
                    product: {
                        description: item.description,
                        product_key: item.productCode || '84111506',
                        unit_key: item.unitCode || 'E48',
                        price: item.unitPrice,
                        tax_included: false, // price is BASE (pre-tax); Facturapi adds IVA/ISR on top
                        taxes,
                    },
                };
            });

            // SAT rule: when receiver is XAXX010101000 (Público en General), force use = S01
            const isPublicoGeneral = rfc.toUpperCase() === 'XAXX010101000';

            const stamped = await facturapiCreateInvoice({
                customer: customerId,
                type: 'I',
                use: isPublicoGeneral ? 'S01' : cfdiUse,
                payment_method: paymentMethod as 'PUE' | 'PPD',
                payment_form: effectivePaymentForm,
                currency: 'MXN',
                items: facturapiItems,
                series: 'A',
            });

            // Step 3: Download PDF and XML separately
            setTimbradoStep('download');

            // Download PDF
            try {
                const pdfBlob = await facturapiDownloadPdf(stamped.id);
                triggerBlobDownload(pdfBlob, `factura-${stamped.uuid}.pdf`);
            } catch (pdfErr) {
                console.warn('PDF download failed:', pdfErr);
            }

            // Small delay so browser doesn't block second download
            await new Promise(r => setTimeout(r, 800));

            // Download XML
            try {
                const xmlBlob = await facturapiDownloadXml(stamped.id);
                triggerBlobDownload(xmlBlob, `factura-${stamped.uuid}.xml`);
            } catch (xmlErr) {
                console.warn('XML download failed:', xmlErr);
            }

            // Step 4: Save to Supabase (graceful fail)
            try {
                await api.createInvoice({
                    clientId: selectedClient?.id || '',
                    clientName: fiscalName, clientRfc: rfc,
                    clientFiscalRegime: selectedRegime as any, clientPostalCode: postalCode,
                    clientUseCFDI: cfdiUse, paymentForm: effectivePaymentForm as any,
                    paymentMethod, currency: 'MXN', exchangeRate: 1,
                    placeOfIssue: postalCode, exportation: '01',
                    subtotal, totalTaxesTransferred: totalIva,
                    totalTaxesRetained: totalIsr, total,
                    status: 'Stamped' as any, uuid: stamped.uuid,
                    items: items.map(i => ({ ...i, productCode: i.productCode, unitCode: i.unitCode, taxObject: '02', taxes: [] })),
                    date: new Date().toISOString(), series: stamped.series || 'A', folio: stamped.folio_number,
                });
            } catch (e) { console.warn('Supabase save skipped (not configured):', e); }

            setInvoiceResult({ uuid: stamped.uuid, folioNumber: stamped.folio_number, series: stamped.series || 'A' });
            setTimbradoStep('done');

        } catch (err: any) {
            console.error(err);
            setTimbradoError(err.message || 'Ocurrió un error inesperado.');
            setTimbradoStep('error');
        }
    };

    const resetForm = () => {
        setTimbradoStep('idle'); setTimbradoError(null); setInvoiceResult(null);
        setItems([]); setSelectedClient(null); setSearchTerm(''); setRfc('');
        setFiscalName(''); setPostalCode(''); setSelectedRegime(''); setClientEmail(''); setErrors({});
    };

    // ── Timbrado overlay (progress / success / error) ──────────────────────
    if (timbradoStep !== 'idle') {
        return (
            <div className="max-w-7xl mx-auto animate-fade-in">
                <div className="flex justify-between items-end border-b border-gray-200 dark:border-gray-700 pb-6 mb-8">
                    <div>
                        <h1 className="font-serif text-4xl dark:text-white text-primary mb-2">Facturación 4.0</h1>
                        <p className="text-xs font-mono uppercase tracking-widest text-gray-400">Emisión de Comprobantes Fiscales Digitales</p>
                    </div>
                </div>
                <div className="max-w-md mx-auto">
                    {timbradoStep === 'error' && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-8 text-center space-y-4">
                            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto"><AlertCircle size={32} className="text-red-500" /></div>
                            <h2 className="font-serif text-2xl text-red-700 dark:text-red-400">Error al Timbrar</h2>
                            <p className="text-sm text-red-600 dark:text-red-300 bg-red-100 dark:bg-red-900/40 rounded-lg p-4 font-mono text-left leading-relaxed">{timbradoError}</p>
                            <button onClick={() => { setTimbradoStep('idle'); setTimbradoError(null); }} className="w-full py-3 bg-primary text-white text-xs font-bold uppercase tracking-widest rounded-lg hover:bg-black transition-colors">
                                Corregir e intentar de nuevo
                            </button>
                        </div>
                    )}
                    {timbradoStep === 'done' && invoiceResult && (
                        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-8 text-center space-y-6 shadow-xl">
                            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto"><CheckCircle size={32} className="text-green-500" /></div>
                            <div>
                                <h2 className="font-serif text-2xl text-primary dark:text-white mb-1">¡Factura Timbrada!</h2>
                                <p className="text-xs text-gray-400 uppercase tracking-widest">CFDI 4.0 válido ante el SAT</p>
                            </div>
                            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-left space-y-3">
                                <div>
                                    <p className="text-[10px] uppercase tracking-widest text-gray-400">Folio Fiscal (UUID)</p>
                                    <p className="font-mono text-xs text-gray-800 dark:text-gray-200 break-all mt-1">{invoiceResult.uuid}</p>
                                </div>
                                <div className="flex gap-6">
                                    <div><p className="text-[10px] uppercase tracking-widest text-gray-400">Serie</p><p className="font-mono text-sm">{invoiceResult.series}</p></div>
                                    <div><p className="text-[10px] uppercase tracking-widest text-gray-400">Folio</p><p className="font-mono text-sm">{invoiceResult.folioNumber}</p></div>
                                    <div><p className="text-[10px] uppercase tracking-widest text-gray-400">Total</p><p className="font-mono text-sm">${total.toFixed(2)} MXN</p></div>
                                </div>
                            </div>
                            <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                                <Download size={12} /> PDF y XML descargados automáticamente
                            </div>
                            <button onClick={resetForm} className="w-full py-3 bg-primary text-white text-xs font-bold uppercase tracking-widest rounded-lg hover:bg-black transition-colors">Emitir otra factura</button>
                        </div>
                    )}
                    {timbradoStep !== 'error' && timbradoStep !== 'done' && (
                        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-8 shadow-xl space-y-6">
                            <div className="text-center">
                                <h2 className="font-serif text-2xl text-primary dark:text-white mb-1">Procesando Factura</h2>
                                <p className="text-xs text-gray-400 uppercase tracking-widest">Por favor espera...</p>
                            </div>
                            <StepIndicator current={timbradoStep} />
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Main form ──────────────────────────────────────────────────────────
    return (
        <>
            {showPreview && (
                <PreviewModal
                    onClose={() => setShowPreview(false)}
                    fiscalName={fiscalName} rfc={rfc} postalCode={postalCode}
                    selectedRegime={selectedRegime} cfdiUse={cfdiUse}
                    paymentMethod={paymentMethod} effectivePaymentForm={effectivePaymentForm}
                    items={items}
                />
            )}

            <div className="max-w-7xl mx-auto space-y-8 pb-12 animate-fade-in">
                {/* Header + Tabs */}
                <div className="border-b border-gray-200 dark:border-gray-700 pb-0">
                    <div className="flex justify-between items-start pb-4">
                        <div>
                            <h1 className="font-serif text-4xl dark:text-white text-primary mb-2">Facturación 4.0</h1>
                            <p className="text-xs font-mono uppercase tracking-widest text-gray-400">Emisión de Comprobantes Fiscales Digitales</p>
                        </div>
                        {activeTab === 'nueva' && (
                            <div className="flex gap-4">
                                <button onClick={handlePreview} className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs uppercase tracking-widest font-bold text-gray-500 hover:text-primary transition-colors shadow-sm rounded-lg">
                                    <Eye size={16} /> Vista Previa
                                </button>
                                <button onClick={handleTimbrar} className="flex items-center gap-2 px-6 py-3 bg-primary text-white text-xs uppercase tracking-widest font-bold shadow-lg hover:bg-primary/90 transition-colors rounded-lg">
                                    <Check size={16} /> Timbrar Factura
                                </button>
                            </div>
                        )}
                        {activeTab === 'historial' && (
                            <button onClick={loadInvoices} disabled={historialLoading} className="flex items-center gap-2 px-5 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs uppercase tracking-widest font-bold text-gray-500 hover:text-primary rounded-lg transition-colors">
                                <RefreshCw size={14} className={historialLoading ? 'animate-spin' : ''} /> Actualizar
                            </button>
                        )}
                    </div>
                    {/* Tab bar */}
                    <div className="flex gap-0">
                        <button onClick={() => setActiveTab('nueva')} className={`flex items-center gap-2 px-6 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors ${activeTab === 'nueva' ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                            <FileText size={14} /> Nueva Factura
                        </button>
                        <button onClick={() => setActiveTab('historial')} className={`flex items-center gap-2 px-6 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors ${activeTab === 'historial' ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                            <ReceiptText size={14} /> Mis Facturas {histTotalResults > 0 && <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10px]">{histTotalResults}</span>}
                        </button>
                    </div>
                </div>

                {/* ── Mis Facturas Tab ── */}
                {activeTab === 'historial' && (
                    <div className="space-y-6">
                        {/* Search & filter bar */}
                        <div className="flex flex-wrap gap-4 items-center">
                            <div className="relative flex-1 min-w-[220px]">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Buscar por cliente, RFC o folio..."
                                    value={histSearch}
                                    onChange={e => { setHistSearch(e.target.value); setHistPage(1); }}
                                    className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-primary transition-colors"
                                />
                                {histSearch && (
                                    <button onClick={() => { setHistSearch(''); setHistPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                        <XCircle size={14} />
                                    </button>
                                )}
                            </div>
                            <select value={histStatus} onChange={e => { setHistStatus(e.target.value as any); setHistPage(1); }} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors">
                                <option value="all">Todos los estados</option>
                                <option value="valid">Válida</option>
                                <option value="canceled">Cancelada</option>
                                <option value="draft">Borrador</option>
                            </select>
                        </div>

                        {/* Error */}
                        {historialError && (
                            <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl text-sm text-red-600 dark:text-red-300">
                                <AlertCircle size={16} className="flex-shrink-0" />
                                <span>{historialError}</span>
                            </div>
                        )}

                        {/* Loading skeleton */}
                        {historialLoading && (
                            <div className="space-y-3">
                                {[1,2,3,4,5].map(i => (
                                    <div key={i} className="h-[72px] bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
                                ))}
                            </div>
                        )}

                        {/* Invoice list */}
                        {!historialLoading && !historialError && (
                            <>
                                {historialList.length === 0 ? (
                                    <div className="text-center py-20 text-gray-400">
                                        <ReceiptText size={40} className="mx-auto mb-4 opacity-30" />
                                        <p className="text-sm italic">No se encontraron facturas</p>
                                    </div>
                                ) : (
                                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden shadow-sm">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="border-b border-gray-100 dark:border-gray-700 text-[10px] uppercase tracking-widest text-gray-400">
                                                    <th className="px-5 py-3 text-left">Folio</th>
                                                    <th className="px-5 py-3 text-left">Fecha</th>
                                                    <th className="px-5 py-3 text-left">Cliente</th>
                                                    <th className="px-5 py-3 text-left">RFC</th>
                                                    <th className="px-5 py-3 text-center">Estado</th>
                                                    <th className="px-5 py-3 text-right">Total</th>
                                                    <th className="px-5 py-3 text-center">Descargas</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                                                {historialList.map(inv => {
                                                    const date = new Date(inv.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
                                                    const statusMap: Record<string, { label: string; cls: string }> = {
                                                        valid:    { label: 'Válida',    cls: 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400' },
                                                        canceled: { label: 'Cancelada', cls: 'bg-red-50 text-red-500 dark:bg-red-900/20 dark:text-red-400' },
                                                        draft:    { label: 'Borrador',  cls: 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400' },
                                                    };
                                                    const status = statusMap[inv.status] ?? { label: inv.status, cls: 'bg-gray-100 text-gray-500' };
                                                    return (
                                                        <tr key={inv.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors group">
                                                            <td className="px-5 py-4">
                                                                <span className="font-mono font-bold text-primary dark:text-primary-light">{inv.series}{inv.folio_number}</span>
                                                            </td>
                                                            <td className="px-5 py-4 text-gray-500 text-xs">{date}</td>
                                                            <td className="px-5 py-4">
                                                                <p className="font-medium text-gray-800 dark:text-gray-200 truncate max-w-[180px]">{inv.customer?.legal_name || '—'}</p>
                                                                {inv.uuid && <p className="font-mono text-[10px] text-gray-400 truncate max-w-[180px]">{inv.uuid}</p>}
                                                            </td>
                                                            <td className="px-5 py-4 font-mono text-xs text-gray-500">{inv.customer?.tax_id || '—'}</td>
                                                            <td className="px-5 py-4 text-center">
                                                                <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${status.cls}`}>{status.label}</span>
                                                            </td>
                                                            <td className="px-5 py-4 text-right font-mono font-bold text-gray-800 dark:text-gray-200">
                                                                ${(inv.total ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                                            </td>
                                                            <td className="px-5 py-4">
                                                                <div className="flex items-center justify-center gap-2">
                                                                    <button
                                                                        onClick={() => handleDownloadPdf(inv)}
                                                                        disabled={downloadingId === inv.id + '-pdf'}
                                                                        title="Descargar PDF"
                                                                        className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 rounded-lg hover:bg-rose-100 transition-colors disabled:opacity-50"
                                                                    >
                                                                        {downloadingId === inv.id + '-pdf' ? <Loader size={10} className="animate-spin" /> : <Download size={10} />}
                                                                        PDF
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDownloadXml(inv)}
                                                                        disabled={downloadingId === inv.id + '-xml'}
                                                                        title="Descargar XML"
                                                                        className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
                                                                    >
                                                                        {downloadingId === inv.id + '-xml' ? <Loader size={10} className="animate-spin" /> : <Download size={10} />}
                                                                        XML
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}

                                {/* Pagination */}
                                {histTotalPages > 1 && (
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs text-gray-400">{histTotalResults} facturas totales · Página {histPage} de {histTotalPages}</p>
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

                {/* ── Nueva Factura Tab content follows ── */}
                {activeTab === 'nueva' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Panel */}
                    <div className="lg:col-span-1 space-y-8">
                        {/* Client */}
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-6 flex items-center gap-2"><Search size={16} /> Datos del Cliente</h3>
                            <div className="space-y-4">
                                <div className="relative">
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Buscar Cliente</label>
                                    <input type="text" value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setShowClientDropdown(true); }} onFocus={() => setShowClientDropdown(true)}
                                        className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors" placeholder="Nombre o RFC..." />
                                    {showClientDropdown && searchTerm && (
                                        <div className="absolute z-10 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 mt-1 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                                            {filteredClients.map(client => (
                                                <div key={client.id} onClick={() => handleSelectClient(client)} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-50 last:border-0">
                                                    <div className="font-bold text-sm text-gray-800 dark:text-gray-200">{client.fullName}</div>
                                                    <div className="text-xs text-gray-400 flex justify-between"><span>{client.rfc || 'Sin RFC'}</span><span>{client.email}</span></div>
                                                </div>
                                            ))}
                                            {filteredClients.length === 0 && <div className="px-4 py-3 text-xs text-gray-400 italic">No se encontraron clientes</div>}
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">RFC <span className="text-red-500">*</span></label>
                                    <input type="text" value={rfc} onChange={e => setRfc(e.target.value.toUpperCase())} className={`w-full bg-gray-50 dark:bg-gray-900 border ${errors.rfc ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'} rounded-lg px-4 py-2 text-sm font-mono focus:outline-none focus:border-primary transition-colors uppercase`} placeholder="XAXX010101000" />
                                    {errors.rfc && <p className="text-[10px] text-red-500 mt-1">{errors.rfc}</p>}
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Razón Social <span className="text-red-500">*</span></label>
                                    <input type="text" value={fiscalName} onChange={e => setFiscalName(e.target.value.toUpperCase())} className={`w-full bg-gray-50 dark:bg-gray-900 border ${errors.fiscalName ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'} rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors uppercase`} placeholder="SIN SA DE CV" />
                                    <p className="text-[9px] text-gray-400 mt-1">Tal cual aparece en la Constancia de Situación Fiscal.</p>
                                    {errors.fiscalName && <p className="text-[10px] text-red-500 mt-1">{errors.fiscalName}</p>}
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Código Postal <span className="text-red-500">*</span></label>
                                        <input type="text" value={postalCode} onChange={e => setPostalCode(e.target.value)} className={`w-full bg-gray-50 dark:bg-gray-900 border ${errors.postalCode ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'} rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors`} />
                                        {errors.postalCode && <p className="text-[10px] text-red-500 mt-1">{errors.postalCode}</p>}
                                    </div>
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Régimen Fiscal <span className="text-red-500">*</span></label>
                                        <select value={selectedRegime} onChange={e => setSelectedRegime(e.target.value)} className={`w-full bg-gray-50 dark:bg-gray-900 border ${errors.selectedRegime ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'} rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors`}>
                                            <option value="">Seleccionar</option>
                                            {Object.values(FiscalRegime).map(regime => <option key={regime} value={regime}>{regime} – {REGIME_DESCRIPTIONS[regime] || ''}</option>)}
                                        </select>
                                        {errors.selectedRegime && <p className="text-[10px] text-red-500 mt-1">{errors.selectedRegime}</p>}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Email (para envío automático)</label>
                                    <input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors" placeholder="cliente@empresa.com" />
                                </div>
                            </div>
                        </div>

                        {/* Payment Settings */}
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-6">Detalles del Pago</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Uso de CFDI</label>
                                    <select value={cfdiUse} onChange={e => setCfdiUse(e.target.value as CFDIUse)} className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors">
                                        {Object.entries(CFDIUse).map(([k, v]) => <option key={k} value={v}>{v} – {CFDI_USE_DESCRIPTIONS[v] || k}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Método de Pago</label>
                                    <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)} className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors">
                                        <option value={PaymentMethod.PUE}>PUE – Pago en una sola exhibición</option>
                                        <option value={PaymentMethod.PPD}>PPD – Pago en parcialidades o diferido</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
                                        Forma de Pago
                                        {paymentMethod === PaymentMethod.PPD && <span className="ml-2 text-amber-500 text-[9px]">⚠ Forzada 99 (regla SAT-PPD)</span>}
                                    </label>
                                    <select value={paymentMethod === PaymentMethod.PPD ? '99' : paymentForm} onChange={e => setPaymentForm(e.target.value as PaymentForm)} disabled={paymentMethod === PaymentMethod.PPD} className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                                        {paymentMethod === PaymentMethod.PPD
                                            ? <option value="99">99 – Por Definir</option>
                                            : Object.entries(PaymentForm).map(([k, v]) => <option key={k} value={v}>{v} – {k}</option>)
                                        }
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Tax legend */}
                        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-4 space-y-2">
                            <p className="text-[10px] uppercase tracking-widest text-blue-500 font-bold">Impuestos Aplicados</p>
                            <div className="flex justify-between text-xs text-blue-700 dark:text-blue-300">
                                <span>IVA Trasladado</span><span className="font-mono font-bold">8%</span>
                            </div>
                            <div className="flex justify-between text-xs text-orange-600 dark:text-orange-400">
                                <span>ISR Retenido (opcional por concepto)</span><span className="font-mono font-bold">1.25%</span>
                            </div>
                        </div>
                    </div>

                    {/* Right Panel: Concepts */}
                    <div className="lg:col-span-2 space-y-8">
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 min-h-[500px] flex flex-col">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500">Conceptos</h3>
                                <button onClick={addItem} className="flex items-center gap-1 text-xs font-bold text-primary hover:text-primary/80 uppercase tracking-widest">
                                    <Plus size={14} /> Agregar Concepto
                                </button>
                            </div>

                            {errors.items && <div className="mb-4 p-3 bg-red-50 text-red-500 text-xs rounded-lg flex items-center gap-2"><AlertCircle size={14} />{errors.items}</div>}

                            <div className="flex-1 overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-gray-100 dark:border-gray-700 text-[10px] uppercase tracking-widest text-gray-400">
                                            <th className="py-2 w-16">Cant.</th>
                                            <th className="py-2">Descripción</th>
                                            <th className="py-2 w-28">P. Unitario</th>
                                            <th className="py-2 w-16 text-center" title="Retener ISR 1.25%">ISR</th>
                                            <th className="py-2 w-28 text-right">Importe</th>
                                            <th className="py-2 w-8"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                                        {items.map((item, index) => (
                                            <tr key={item.id} className="group">
                                                <td className="py-3 align-top">
                                                    <input type="number" value={item.quantity} onChange={e => updateItem(index, 'quantity', parseFloat(e.target.value))} className="w-full bg-transparent border-b border-transparent focus:border-primary focus:outline-none text-sm text-center" min="1" />
                                                    {errors[`item_${index}_qty`] && <p className="text-[9px] text-red-500 mt-1">{errors[`item_${index}_qty`]}</p>}
                                                </td>
                                                <td className="py-3 align-top">
                                                    <textarea value={item.description} onChange={e => updateItem(index, 'description', e.target.value)} className="w-full bg-transparent border-b border-gray-100 focus:border-primary focus:outline-none text-sm resize-none" rows={2} placeholder="Descripción del servicio..." />
                                                    {errors[`item_${index}_desc`] && <p className="text-[9px] text-red-500 mt-1">{errors[`item_${index}_desc`]}</p>}
                                                    <div className="flex gap-2 mt-1">
                                                        <input type="text" value={item.productCode} onChange={e => updateItem(index, 'productCode', e.target.value)} className="text-[10px] bg-gray-50 text-gray-500 rounded px-1 w-20 border-none" title="ClaveProdServ" />
                                                        <input type="text" value={item.unitCode} onChange={e => updateItem(index, 'unitCode', e.target.value)} className="text-[10px] bg-gray-50 text-gray-500 rounded px-1 w-12 border-none" title="ClaveUnidad" />
                                                    </div>
                                                </td>
                                                <td className="py-3 align-top">
                                                    <div className="relative">
                                                        <span className="absolute left-0 top-0 text-gray-400 text-sm">$</span>
                                                        <input type="number" value={item.unitPrice} onChange={e => updateItem(index, 'unitPrice', parseFloat(e.target.value))} className="w-full pl-3 bg-transparent border-b border-transparent focus:border-primary focus:outline-none text-sm text-right" />
                                                    </div>
                                                </td>
                                                <td className="py-3 align-top text-center">
                                                    <label className="relative inline-flex items-center cursor-pointer mt-1" title="Aplicar retención ISR 1.25%">
                                                        <input type="checkbox" checked={item.includeIsr} onChange={e => updateItem(index, 'includeIsr', e.target.checked)} className="sr-only peer" />
                                                        <div className="w-8 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-orange-500"></div>
                                                    </label>
                                                    {item.includeIsr && <p className="text-[9px] text-orange-500 mt-1 font-mono">−{(item.quantity * item.unitPrice * ISR_RATE).toFixed(2)}</p>}
                                                </td>
                                                <td className="py-3 align-top text-right text-sm font-mono text-gray-700 dark:text-gray-300">
                                                    ${(item.quantity * item.unitPrice).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                                </td>
                                                <td className="py-3 align-top text-center">
                                                    <button onClick={() => removeItem(index)} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                                                </td>
                                            </tr>
                                        ))}
                                        {items.length === 0 && (
                                            <tr><td colSpan={6} className="py-8 text-center text-sm text-gray-400 italic">Agrega conceptos a la factura</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Totals */}
                            <div className="mt-8 border-t border-gray-100 dark:border-gray-700 pt-6 flex justify-end">
                                <div className="w-72 space-y-3">
                                    <div className="flex justify-between text-sm text-gray-500">
                                        <span>Subtotal</span>
                                        <span className="font-mono">${subtotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex justify-between text-sm text-gray-500">
                                        <span>IVA Trasladado (8%)</span>
                                        <span className="font-mono text-green-600">+${totalIva.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                    {totalIsr > 0 && (
                                        <div className="flex justify-between text-sm text-orange-500">
                                            <span>ISR Retenido (1.25%)</span>
                                            <span className="font-mono">−${totalIsr.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between text-xl font-serif text-gray-900 dark:text-white pt-3 border-t border-gray-100 dark:border-gray-700">
                                        <span>Total</span>
                                        <span>${total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                )} {/* end activeTab === 'nueva' */}
            </div>
        </>
    );
};


export default Invoicing;
