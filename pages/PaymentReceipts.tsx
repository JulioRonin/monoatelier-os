import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    facturapiListInvoices,
    facturapiRetrieveInvoice,
    facturapiFindOrCreateCustomer,
    facturapiCreatePaymentComplement,
    facturapiDownloadPdf,
    facturapiDownloadXml,
    estructuraDeFactura,
    facturapiModo,
    triggerBlobDownload,
    type FacturapiInvoiceRecord,
} from '../lib/facturapi';
import {
    leerCfdi,
    motivoParaNoTimbrarRep,
    repartirImpuestos,
    desglosarPago,
    estructuraSupuesta,
    redondear,
    CfdiInvalido,
    type CfdiExterno,
    type CfdiImpuesto,
} from '../lib/cfdi';
import { api } from '../lib/api';
import type { FacturaExterna, RepPago } from '../types';
import {
    Search, Check, AlertCircle, CheckCircle, Loader, Download,
    ReceiptText, RefreshCw, ChevronLeft, ChevronRight, XCircle, CreditCard,
    Upload, FileText, Trash2, Info,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Franja fronteriza norte. Sólo se usa como SUPUESTO cuando no se conoce la
 *  estructura fiscal real de la factura, y en ese caso se avisa en pantalla. */
const IVA_RATE = 0.08;

/** RFC del emisor, si está configurado. Sirve para avisar cuando alguien
 *  importa una factura RECIBIDA: de esas no se emite REP, se recibe. */
const RFC_EMISOR = (import.meta.env.VITE_RFC_EMISOR || '').toUpperCase();

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
// Documento por pagar — una factura PPD, venga de donde venga
// ---------------------------------------------------------------------------

/**
 * El REP no distingue de dónde salió la factura: se relaciona por UUID. Esta
 * forma unifica las facturas timbradas aquí (Facturapi) con las importadas de
 * otra plataforma, para que el resto de la pantalla no tenga que preguntarlo.
 */
interface DocPorPagar {
    origen: 'facturapi' | 'externa';
    uuid: string;
    serie: string;
    folio: string;
    fecha: string;
    total: number;
    subtotal: number;
    moneda: string;
    tipoCambio: number;
    impuestos: CfdiImpuesto[];
    /** true = la estructura fiscal se supuso, no se leyó. Se avisa en pantalla. */
    estructuraSupuesta: boolean;
    clienteNombre: string;
    clienteRfc: string;
    /** id del cliente en Facturapi, si la factura salió de ahí */
    clienteFacturapiId?: string;
    clienteRegimen?: string;
    clienteCp?: string;
    /** id del documento en Facturapi (para leer su detalle) */
    facturapiId?: string;
}

const etiqueta = (d: { serie?: string; folio?: string | number }) =>
    `${d.serie || ''}${d.folio ?? ''}` || 's/folio';

function docDeFacturapi(inv: FacturapiInvoiceRecord): DocPorPagar {
    const derivada = estructuraDeFactura(inv);
    const usable = derivada && derivada.cuadra;
    return {
        origen: 'facturapi',
        uuid: (inv.uuid || '').toLowerCase(),
        serie: inv.series || '',
        folio: String(inv.folio_number ?? ''),
        fecha: inv.created_at,
        total: inv.total,
        subtotal: usable ? derivada!.subtotal : redondear(inv.total / (1 + IVA_RATE)),
        moneda: inv.currency || 'MXN',
        tipoCambio: 1,
        impuestos: usable ? derivada!.impuestos : estructuraSupuesta(inv.total, IVA_RATE),
        estructuraSupuesta: !usable,
        clienteNombre: inv.customer?.legal_name || '',
        clienteRfc: inv.customer?.tax_id || '',
        clienteFacturapiId: inv.customer?.id,
        clienteRegimen: inv.customer?.tax_system,
        clienteCp: inv.customer?.address?.zip,
        facturapiId: inv.id,
    };
}

function docDeExterna(f: FacturaExterna): DocPorPagar {
    return {
        origen: 'externa',
        uuid: f.uuid,
        serie: f.serie,
        folio: f.folio,
        fecha: f.fecha,
        total: f.total,
        subtotal: f.subtotal,
        moneda: f.moneda,
        tipoCambio: f.tipoCambio,
        impuestos: f.impuestos as CfdiImpuesto[],
        estructuraSupuesta: false,
        clienteNombre: f.receptorNombre,
        clienteRfc: f.receptorRfc,
        clienteRegimen: f.receptorRegimen,
        clienteCp: f.receptorCp,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const money = (n: number, moneda = 'MXN') =>
    `$${(n ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda}`;

/** `datetime-local` habla en hora LOCAL. toISOString() da UTC y adelantaría el
 *  pago varias horas — en un pago del día 5 eso puede cambiarle el mes. */
function ahoraLocal(): string {
    const d = new Date();
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

// ---------------------------------------------------------------------------
// Timbrado flow
// ---------------------------------------------------------------------------
type TimbradoStep = 'idle' | 'customer' | 'rep' | 'download' | 'done' | 'error';

const STEPS: { key: TimbradoStep; label: string }[] = [
    { key: 'customer', label: 'Sincronizando receptor con el SAT' },
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
// Importador de facturas externas
// ---------------------------------------------------------------------------

interface ImportadorProps {
    externas: FacturaExterna[];
    onGuardada: () => void;
    onEliminar: (f: FacturaExterna) => void;
}

function ImportadorExternas({ externas, onGuardada, onEliminar }: ImportadorProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [leida, setLeida] = useState<CfdiExterno | null>(null);
    const [xmlCrudo, setXmlCrudo] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);
    const [guardando, setGuardando] = useState(false);
    const [arrastrando, setArrastrando] = useState(false);

    const procesar = async (file: File) => {
        setError(null); setAviso(null); setLeida(null);
        try {
            const texto = await file.text();
            const cfdi = leerCfdi(texto);

            const motivo = motivoParaNoTimbrarRep(cfdi);
            if (motivo) { setError(motivo); return; }

            if (RFC_EMISOR && cfdi.emisorRfc !== RFC_EMISOR) {
                setAviso(`Esta factura la emitió ${cfdi.emisorRfc}, no ${RFC_EMISOR}. ` +
                         'Si es una factura que TE emitieron, el REP lo timbra quien la emitió, no tú.');
            }
            setLeida(cfdi);
            setXmlCrudo(texto);
        } catch (e: any) {
            setError(e instanceof CfdiInvalido ? e.message : `No pude leer el archivo: ${e.message}`);
        }
    };

    const guardar = async () => {
        if (!leida) return;
        setGuardando(true);
        try {
            await api.guardarFacturaExterna(leida, xmlCrudo);
            setLeida(null); setXmlCrudo(''); setAviso(null);
            if (inputRef.current) inputRef.current.value = '';
            onGuardada();
        } catch (e: any) {
            setError(`No se pudo guardar: ${e.message}. ` +
                     '¿Corriste supabase/migrations/20260817_rep_facturas_externas.sql?');
        } finally { setGuardando(false); }
    };

    return (
        <div className="space-y-6">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-5 flex gap-3">
                <Info size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                    <p className="font-bold">Para facturas timbradas en otra plataforma</p>
                    <p className="text-xs leading-relaxed opacity-90">
                        El Complemento de Pago se relaciona con la factura sólo por su UUID, así que
                        puede timbrarse aquí aunque la factura haya salido de otro PAC. Sube el XML
                        timbrado (no el PDF) y la factura queda disponible en “Emitir REP”.
                    </p>
                </div>
            </div>

            {/* Zona de carga */}
            <div
                onDragOver={e => { e.preventDefault(); setArrastrando(true); }}
                onDragLeave={() => setArrastrando(false)}
                onDrop={e => {
                    e.preventDefault(); setArrastrando(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) procesar(f);
                }}
                onClick={() => inputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${arrastrando ? 'border-primary bg-primary/5' : 'border-gray-200 dark:border-gray-700 hover:border-primary/50'}`}
            >
                <Upload size={28} className="mx-auto mb-3 text-gray-300" />
                <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">
                    Arrastra el XML del CFDI o haz clic para elegirlo
                </p>
                <p className="text-[11px] text-gray-400 mt-1">
                    Sólo el XML timbrado (CFDI 4.0). El PDF no sirve: no lleva el UUID en un formato legible.
                </p>
                <input
                    ref={inputRef} type="file" accept=".xml,text/xml,application/xml" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) procesar(f); }}
                />
            </div>

            {error && (
                <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl text-sm text-red-700 dark:text-red-300">
                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
                </div>
            )}
            {aviso && (
                <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl text-sm text-amber-800 dark:text-amber-200">
                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" /><span>{aviso}</span>
                </div>
            )}

            {/* Vista previa antes de registrar */}
            {leida && (
                <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-6 shadow-sm space-y-5">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 flex items-center gap-2">
                            <FileText size={15} /> Factura leída
                        </h3>
                        <span className="text-[10px] uppercase tracking-widest px-2 py-1 rounded bg-green-50 text-green-600 font-bold">
                            {leida.metodoPago} · CFDI 4.0
                        </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                        <div><span className="text-gray-400">Folio</span><p className="font-mono font-bold">{etiqueta(leida)}</p></div>
                        <div><span className="text-gray-400">Fecha</span><p className="font-mono">{new Date(leida.fecha).toLocaleDateString('es-MX')}</p></div>
                        <div><span className="text-gray-400">Receptor</span><p className="font-medium truncate">{leida.receptorNombre}</p></div>
                        <div><span className="text-gray-400">RFC</span><p className="font-mono">{leida.receptorRfc}</p></div>
                        <div><span className="text-gray-400">Régimen</span><p className="font-mono">{leida.receptorRegimen}</p></div>
                        <div><span className="text-gray-400">CP receptor</span><p className="font-mono">{leida.receptorCp}</p></div>
                        <div><span className="text-gray-400">Subtotal</span><p className="font-mono">{money(leida.subtotal, leida.moneda)}</p></div>
                        <div><span className="text-gray-400">Total</span><p className="font-mono font-bold text-primary">{money(leida.total, leida.moneda)}</p></div>
                    </div>

                    {!leida.serie && (
                        <p className="text-[11px] text-gray-400 italic">
                            Esta factura no tiene serie (el CFDI la trae como opcional). Se registra sin serie, tal cual.
                        </p>
                    )}

                    <div>
                        <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-2">Impuestos de la factura</p>
                        <div className="space-y-1">
                            {leida.impuestos.length === 0 && (
                                <p className="text-xs text-gray-400 italic">Sin impuestos desglosados.</p>
                            )}
                            {leida.impuestos.map((i, n) => (
                                <div key={n} className="flex justify-between text-xs">
                                    <span className={i.retencion ? 'text-amber-600' : 'text-gray-500'}>
                                        {i.retencion ? 'Retenido' : 'Trasladado'} {i.tipo} {(i.tasa * 100).toFixed(2)}%
                                        <span className="text-gray-400"> · base {money(i.base, leida.moneda)}</span>
                                    </span>
                                    <span className={`font-mono ${i.retencion ? 'text-amber-600' : 'text-green-600'}`}>
                                        {i.retencion ? '−' : '+'}{money(i.importe, leida.moneda)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                        <p className="text-[10px] uppercase tracking-widest text-gray-400">Folio Fiscal (UUID)</p>
                        <p className="font-mono text-xs break-all mt-1">{leida.uuid}</p>
                    </div>

                    <button onClick={guardar} disabled={guardando}
                        className="w-full py-3 bg-primary text-white text-xs font-bold uppercase tracking-widest rounded-lg hover:bg-black transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                        {guardando ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
                        Registrar esta factura
                    </button>
                </div>
            )}

            {/* Ya registradas */}
            <div>
                <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-4">
                    Facturas externas registradas ({externas.length})
                </h3>
                {externas.length === 0 ? (
                    <p className="text-xs text-gray-400 italic py-8 text-center">Todavía no hay ninguna.</p>
                ) : (
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 dark:border-gray-700 text-[10px] uppercase tracking-widest text-gray-400">
                                    <th className="px-5 py-3 text-left">Folio</th>
                                    <th className="px-5 py-3 text-left">Fecha</th>
                                    <th className="px-5 py-3 text-left">Receptor</th>
                                    <th className="px-5 py-3 text-right">Total</th>
                                    <th className="px-5 py-3"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                                {externas.map(f => (
                                    <tr key={f.id}>
                                        <td className="px-5 py-3 font-mono font-bold text-primary">{etiqueta(f)}</td>
                                        <td className="px-5 py-3 text-xs text-gray-500">{new Date(f.fecha).toLocaleDateString('es-MX')}</td>
                                        <td className="px-5 py-3">
                                            <p className="text-xs font-medium truncate max-w-[200px]">{f.receptorNombre}</p>
                                            <p className="font-mono text-[10px] text-gray-400">{f.receptorRfc}</p>
                                        </td>
                                        <td className="px-5 py-3 text-right font-mono font-bold">{money(f.total, f.moneda)}</td>
                                        <td className="px-5 py-3 text-right">
                                            <button onClick={() => onEliminar(f)} className="text-gray-300 hover:text-red-500 transition-colors" title="Quitar del registro">
                                                <Trash2 size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
const PaymentReceipts: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'emitir' | 'externas' | 'historial'>('emitir');

    /** Sandbox o producción, según la llave activa. Los timbres y los saldos
     *  de cada modo viven separados: una prueba no descuenta saldo real. */
    const modo = facturapiModo();

    // ── Documentos por pagar ────────────────────────────────────────────────
    const [ppdFacturapi, setPpdFacturapi] = useState<FacturapiInvoiceRecord[]>([]);
    const [externas, setExternas] = useState<FacturaExterna[]>([]);
    const [pagos, setPagos] = useState<RepPago[]>([]);
    const [loadingPpd, setLoadingPpd] = useState(false);
    const [errorPpd, setErrorPpd] = useState<string | null>(null);

    const [invoiceSearch, setInvoiceSearch] = useState('');
    const [showInvoiceDrop, setShowInvoiceDrop] = useState(false);
    const [doc, setDoc] = useState<DocPorPagar | null>(null);
    const [cargandoDetalle, setCargandoDetalle] = useState(false);

    // ── Datos del pago ──────────────────────────────────────────────────────
    const [paymentDate, setPaymentDate] = useState(ahoraLocal());
    const [paymentForm, setPaymentForm] = useState('03');
    const [exchange, setExchange] = useState(1);
    const [amountPaid, setAmountPaid] = useState(0);

    // ── Timbrado state ──────────────────────────────────────────────────────
    const [timbradoStep, setTimbradoStep] = useState<TimbradoStep>('idle');
    const [timbradoError, setTimbradoError] = useState<string | null>(null);
    const [repResult, setRepResult] = useState<{ uuid: string; folio: number; series: string } | null>(null);
    const [errors, setErrors] = useState<{ [k: string]: string }>({});

    // ── Historial state ─────────────────────────────────────────────────────
    const [histList, setHistList] = useState<FacturapiInvoiceRecord[]>([]);
    const [histLoading, setHistLoading] = useState(false);
    const [histError, setHistError] = useState<string | null>(null);
    const [histSearch, setHistSearch] = useState('');
    const [histPage, setHistPage] = useState(1);
    const [histTotalPages, setHistTotalPages] = useState(1);
    const [histTotal, setHistTotal] = useState(0);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);

    // ── Carga ───────────────────────────────────────────────────────────────
    const cargarExternas = useCallback(async () => {
        try { setExternas(await api.getFacturasExternas()); }
        catch (e) { console.warn('facturas_externas no disponible:', e); }
    }, []);

    const cargarPagos = useCallback(async () => {
        try { setPagos(await api.getRepPagos()); }
        catch (e) { console.warn('rep_pagos no disponible:', e); }
    }, []);

    const loadPpdInvoices = useCallback(async (q = '') => {
        setLoadingPpd(true);
        setErrorPpd(null);
        try {
            const res = await facturapiListInvoices({ limit: 50, status: 'valid', q: q || undefined });
            setPpdFacturapi(res.data.filter(inv => inv.payment_method === 'PPD' && inv.type !== 'P'));
        } catch (e: any) {
            setErrorPpd(e.message);
        } finally { setLoadingPpd(false); }
    }, []);

    useEffect(() => { cargarExternas(); cargarPagos(); }, [cargarExternas, cargarPagos]);

    useEffect(() => {
        const t = setTimeout(() => loadPpdInvoices(invoiceSearch), 400);
        return () => clearTimeout(t);
    }, [invoiceSearch, loadPpdInvoices]);

    // ── Saldos por factura, tomados del libro de pagos ───────────────────────
    // SÓLO los pagos del modo activo: el REP de sandbox que se hizo de prueba
    // no llegó al SAT y no puede dejar la factura real como "liquidada".
    const pagadoPorUuid = useMemo(() => {
        const m = new Map<string, { monto: number; parcialidades: number }>();
        for (const p of pagos) {
            if (p.modo !== (modo === 'test' ? 'test' : 'live')) continue;
            const k = p.facturaUuid.toLowerCase();
            const prev = m.get(k) ?? { monto: 0, parcialidades: 0 };
            m.set(k, {
                monto: redondear(prev.monto + p.monto),
                parcialidades: Math.max(prev.parcialidades, p.parcialidad),
            });
        }
        return m;
    }, [pagos, modo]);

    /** Saldo y parcialidad del documento seleccionado — nunca a mano. */
    const { saldoAnterior, parcialidad } = useMemo(() => {
        if (!doc) return { saldoAnterior: 0, parcialidad: 1 };
        const prev = pagadoPorUuid.get(doc.uuid) ?? { monto: 0, parcialidades: 0 };
        return {
            saldoAnterior: redondear(doc.total - prev.monto),
            parcialidad: prev.parcialidades + 1,
        };
    }, [doc, pagadoPorUuid]);

    const saldoInsoluto = doc ? redondear(saldoAnterior - amountPaid) : 0;

    // Desglose del pago con la estructura REAL de la factura
    const desglose = useMemo(
        () => doc
            ? desglosarPago(doc.impuestos, doc.subtotal, amountPaid, doc.total)
            : { base: 0, trasladado: 0, retenido: 0, total: 0, diferencia: 0 },
        [doc, amountPaid]);

    /** Descuadre de verdad, no redondeo: con dos o tres impuestos la suma puede
     *  moverse un par de centavos y eso es normal. Un peso ya no lo es. */
    const descuadre = !!doc && amountPaid > 0 && Math.abs(desglose.diferencia) > 1;

    // ── Lista unificada del selector ─────────────────────────────────────────
    const opciones = useMemo(() => {
        const q = invoiceSearch.trim().toLowerCase();
        const todos: DocPorPagar[] = [
            ...externas.map(docDeExterna),
            ...ppdFacturapi.map(docDeFacturapi),
        ];
        const coincide = (d: DocPorPagar) => !q ||
            d.clienteNombre.toLowerCase().includes(q) ||
            d.clienteRfc.toLowerCase().includes(q) ||
            etiqueta(d).toLowerCase().includes(q) ||
            d.uuid.includes(q);
        return todos.filter(coincide);
    }, [externas, ppdFacturapi, invoiceSearch]);

    // ── Selección ────────────────────────────────────────────────────────────
    const seleccionar = async (d: DocPorPagar) => {
        setShowInvoiceDrop(false);
        setInvoiceSearch(`${etiqueta(d)} – ${d.clienteNombre}`);
        setErrors({});

        // Para las de Facturapi se pide el detalle completo: la lista viene
        // recortada y sin los impuestos no se puede prorratear el pago.
        let completo = d;
        if (d.origen === 'facturapi' && d.facturapiId) {
            setCargandoDetalle(true);
            try {
                completo = docDeFacturapi(await facturapiRetrieveInvoice(d.facturapiId));
            } catch (e) {
                console.warn('No se pudo leer el detalle de la factura:', e);
            } finally { setCargandoDetalle(false); }
        }

        setDoc(completo);
        const prev = pagadoPorUuid.get(completo.uuid) ?? { monto: 0, parcialidades: 0 };
        setAmountPaid(redondear(completo.total - prev.monto));
        if (completo.moneda !== 'MXN') setExchange(completo.tipoCambio || 1);
    };

    // ── Historial ────────────────────────────────────────────────────────────
    const loadHistorial = useCallback(async () => {
        setHistLoading(true);
        setHistError(null);
        try {
            const res = await facturapiListInvoices({ limit: 20, page: histPage, q: histSearch || undefined });
            setHistList(res.data.filter(inv => inv.type === 'P'));
            setHistTotalPages(res.total_pages);
            setHistTotal(res.total_results);
        } catch (e: any) { setHistError(e.message); }
        finally { setHistLoading(false); }
    }, [histPage, histSearch]);

    useEffect(() => { if (activeTab === 'historial') loadHistorial(); }, [activeTab, loadHistorial]);

    // ── Validación ───────────────────────────────────────────────────────────
    const validate = () => {
        const e: { [k: string]: string } = {};
        if (!doc) e.invoice = 'Selecciona la factura PPD que se está pagando';
        if (amountPaid <= 0) e.amount = 'El monto pagado debe ser mayor a 0';
        if (doc && amountPaid > saldoAnterior + 0.005) {
            e.amount = `El monto no puede pasar del saldo pendiente (${money(saldoAnterior, doc.moneda)})`;
        }
        if (doc && saldoAnterior <= 0) e.amount = 'Esta factura ya está liquidada.';
        if (!doc?.clienteRfc) e.invoice = 'La factura no trae RFC del receptor.';
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    // ── Timbrar ──────────────────────────────────────────────────────────────
    const handleTimbrar = async () => {
        if (!validate() || !doc) return;

        if (modo === 'sin-llave') {
            setErrors({ invoice: 'No hay llave de Facturapi (VITE_FACTURAPI_KEY). Revisa .env.local y reinicia el servidor.' });
            return;
        }

        // En producción el timbre es un CFDI real ante el SAT: se confirma una
        // vez, con los datos a la vista. En sandbox no, para probar sin fricción.
        if (modo === 'live' && !confirm(
            `Vas a timbrar un CFDI REAL ante el SAT:\n\n` +
            `Factura: ${etiqueta(doc)} — ${doc.clienteNombre}\n` +
            `Monto: ${money(amountPaid, doc.moneda)}\n` +
            `Parcialidad ${parcialidad} · saldo anterior ${money(saldoAnterior, doc.moneda)}\n\n` +
            `¿Continuar?`)) {
            return;
        }

        setTimbradoError(null);
        setRepResult(null);
        setTimbradoStep('customer');

        try {
            // 1. Receptor. El del REP debe ser IDÉNTICO al de la factura: mismo
            //    RFC, mismo régimen y mismo código postal. Si la factura salió
            //    de Facturapi ya tenemos su cliente y no hay nada que adivinar.
            let customerId = doc.clienteFacturapiId;
            if (!customerId) {
                if (!doc.clienteRegimen || !doc.clienteCp) {
                    throw new Error(
                        'A la factura le falta el régimen fiscal o el código postal del receptor. ' +
                        'Vuelve a importar su XML: esos dos datos deben ir idénticos en el REP.');
                }
                customerId = await facturapiFindOrCreateCustomer({
                    legal_name: doc.clienteNombre,
                    tax_id: doc.clienteRfc,
                    tax_system: doc.clienteRegimen,
                    address: { zip: doc.clienteCp },
                });
            }

            // 2. El REP. Los impuestos se reparten a prorrata de la estructura
            //    real de la factura; se manda la base y la tasa, y Facturapi
            //    deriva el importe (un solo redondeo, sin discrepancias).
            setTimbradoStep('rep');
            const stamped = await facturapiCreatePaymentComplement({
                customer: customerId,
                series: 'P',
                payments: [{
                    date: new Date(paymentDate).toISOString(),
                    payment_form: paymentForm,
                    currency: doc.moneda,
                    exchange: doc.moneda !== 'MXN' ? exchange : undefined,
                    related_documents: [{
                        uuid: doc.uuid,
                        amount: redondear(amountPaid),
                        installment: parcialidad,
                        last_balance: redondear(saldoAnterior),
                        taxes: repartirImpuestos(doc.impuestos, amountPaid, doc.total),
                    }],
                }],
            });

            // 3. Asentar el pago ANTES de descargar: si la descarga falla, el
            //    REP ya está timbrado y el saldo tiene que reflejarlo.
            try {
                await api.registrarRepPago({
                    facturaUuid: doc.uuid,
                    facturaOrigen: doc.origen,
                    modo: modo === 'test' ? 'test' : 'live',
                    facturaFolio: etiqueta(doc),
                    repUuid: stamped.uuid,
                    repFacturapiId: stamped.id,
                    repSerie: stamped.series || 'P',
                    repFolio: stamped.folio_number,
                    fechaPago: new Date(paymentDate).toISOString(),
                    formaPago: paymentForm,
                    moneda: doc.moneda,
                    tipoCambio: doc.moneda !== 'MXN' ? exchange : 1,
                    monto: redondear(amountPaid),
                    parcialidad,
                    saldoAnterior: redondear(saldoAnterior),
                    saldoInsoluto: redondear(saldoAnterior - amountPaid),
                });
                await cargarPagos();
            } catch (e) {
                console.warn('El REP se timbró pero no se pudo asentar en rep_pagos:', e);
            }

            // 4. Descargas
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
        setDoc(null); setInvoiceSearch(''); setAmountPaid(0); setErrors({});
    };

    // ── Descargas del historial ─────────────────────────────────────────────
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

    const eliminarExterna = async (f: FacturaExterna) => {
        if (!confirm(`¿Quitar la factura ${etiqueta(f)} del registro?\n\nNo cancela nada ante el SAT: sólo deja de aparecer aquí.`)) return;
        try { await api.eliminarFacturaExterna(f.id); await cargarExternas(); }
        catch (e: any) { alert('No se pudo eliminar: ' + e.message); }
    };

    // ── Overlay de timbrado ─────────────────────────────────────────────────
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
                                <p className="text-xs text-gray-400 uppercase tracking-widest">
                                    {modo === 'test' ? 'Timbrado de PRUEBA (sandbox)' : 'Complemento de Pago CFDI 4.0 válido'}
                                </p>
                            </div>
                            {modo === 'test' && (
                                <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-[11px] text-amber-800 dark:text-amber-200 text-left">
                                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                                    <span>
                                        Este REP salió del <strong>sandbox</strong>: no llegó al SAT y su PDF/XML
                                        <strong> no se le manda al cliente</strong>. Para el timbre real, cambia la
                                        llave a la de producción (sk_live_…) y vuelve a timbrar.
                                    </span>
                                </div>
                            )}
                            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-left space-y-3">
                                <div>
                                    <p className="text-[10px] uppercase tracking-widest text-gray-400">Folio Fiscal (UUID)</p>
                                    <p className="font-mono text-xs text-gray-800 dark:text-gray-200 break-all mt-1">{repResult.uuid}</p>
                                </div>
                                <div className="flex gap-6">
                                    <div><p className="text-[10px] uppercase tracking-widest text-gray-400">Serie</p><p className="font-mono text-sm">{repResult.series}</p></div>
                                    <div><p className="text-[10px] uppercase tracking-widest text-gray-400">Folio</p><p className="font-mono text-sm">{repResult.folio}</p></div>
                                    <div><p className="text-[10px] uppercase tracking-widest text-gray-400">Monto pagado</p><p className="font-mono text-sm">{money(amountPaid, doc?.moneda)}</p></div>
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

    // ── UI principal ────────────────────────────────────────────────────────
    return (
        <div className="max-w-7xl mx-auto space-y-8 pb-12 animate-fade-in">
            <div className="border-b border-gray-200 dark:border-gray-700 pb-0">
                <div className="flex justify-between items-start pb-4 flex-wrap gap-4">
                    <div>
                        <div className="flex items-center gap-3 flex-wrap mb-2">
                            <h1 className="font-serif text-4xl dark:text-white text-primary">Complemento de Pago</h1>
                            {/* El modo lo dice la llave activa. Si cambiaste a la de
                                producción y aquí sigue diciendo SANDBOX, el servidor no
                                la ha leído: reinicia npm run dev (o vuelve a hacer build). */}
                            {modo === 'test' && (
                                <span className="text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-bold border border-amber-200">
                                    Sandbox — pruebas, sin validez fiscal
                                </span>
                            )}
                            {modo === 'live' && (
                                <span className="text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full bg-green-100 text-green-700 font-bold border border-green-200">
                                    Producción — timbra ante el SAT
                                </span>
                            )}
                            {modo === 'sin-llave' && (
                                <span className="text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-bold border border-red-200">
                                    Sin llave de Facturapi
                                </span>
                            )}
                        </div>
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
                <div className="flex flex-wrap">
                    <button onClick={() => setActiveTab('emitir')} className={`flex items-center gap-2 px-6 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors ${activeTab === 'emitir' ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                        <CreditCard size={14} /> Emitir REP
                    </button>
                    <button onClick={() => setActiveTab('externas')} className={`flex items-center gap-2 px-6 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors ${activeTab === 'externas' ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                        <Upload size={14} /> Importar factura externa
                        {externas.length > 0 && <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[10px]">{externas.length}</span>}
                    </button>
                    <button onClick={() => setActiveTab('historial')} className={`flex items-center gap-2 px-6 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors ${activeTab === 'historial' ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                        <ReceiptText size={14} /> Historial REP
                    </button>
                </div>
            </div>

            {/* ── Importar factura externa ───────────────────────────────── */}
            {activeTab === 'externas' && (
                <ImportadorExternas
                    externas={externas}
                    onGuardada={() => { cargarExternas(); setActiveTab('emitir'); }}
                    onEliminar={eliminarExterna}
                />
            )}

            {/* ── Emitir REP ─────────────────────────────────────────────── */}
            {activeTab === 'emitir' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Izquierda: factura + pago */}
                    <div className="space-y-6">
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
                                    onChange={e => { setInvoiceSearch(e.target.value); setShowInvoiceDrop(true); setDoc(null); }}
                                    // Al volver al campo se limpia el texto: si no, la búsqueda
                                    // se hace con la etiqueta de lo ya elegido y no sale nada.
                                    onFocus={() => { if (doc) setInvoiceSearch(''); setShowInvoiceDrop(true); }}
                                    placeholder="Folio, cliente, RFC o UUID..."
                                    className={`w-full bg-gray-50 dark:bg-gray-900 border ${errors.invoice ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'} rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors`}
                                />
                                {errors.invoice && <p className="text-[10px] text-red-500 mt-1">{errors.invoice}</p>}

                                {showInvoiceDrop && (
                                    <div className="absolute z-10 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 mt-1 rounded-xl shadow-2xl max-h-80 overflow-y-auto">
                                        {loadingPpd && (
                                            <div className="flex items-center gap-2 px-4 py-3 text-xs text-gray-400">
                                                <Loader size={12} className="animate-spin" /> Cargando facturas PPD...
                                            </div>
                                        )}
                                        {!loadingPpd && opciones.length === 0 && (
                                            <div className="px-4 py-5 text-xs text-gray-400 text-center italic space-y-2">
                                                <p>No hay facturas PPD que coincidan.</p>
                                                <button onClick={() => setActiveTab('externas')} className="text-primary font-bold uppercase tracking-widest not-italic">
                                                    ¿La factura se timbró en otra plataforma? Impórtala
                                                </button>
                                            </div>
                                        )}
                                        {opciones.map(d => {
                                            const prev = pagadoPorUuid.get(d.uuid) ?? { monto: 0, parcialidades: 0 };
                                            const saldo = redondear(d.total - prev.monto);
                                            return (
                                                <div key={`${d.origen}-${d.uuid}`} onClick={() => saldo > 0 && seleccionar(d)}
                                                    className={`px-4 py-3 border-b border-gray-50 dark:border-gray-700 last:border-0 ${saldo > 0 ? 'hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                                                    <div className="flex justify-between items-start gap-2">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="font-mono font-bold text-primary text-sm">{etiqueta(d)}</span>
                                                            {d.origen === 'externa' && (
                                                                <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">externa</span>
                                                            )}
                                                            <span className="text-xs text-gray-400">{new Date(d.fecha).toLocaleDateString('es-MX')}</span>
                                                        </div>
                                                        <span className="font-mono text-sm font-bold whitespace-nowrap">{money(d.total, d.moneda)}</span>
                                                    </div>
                                                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{d.clienteNombre}</p>
                                                    <p className="font-mono text-[10px] text-gray-400">
                                                        {d.clienteRfc} · {saldo > 0
                                                            ? <>saldo {money(saldo, d.moneda)}{prev.parcialidades > 0 && ` · ${prev.parcialidades} parcialidad(es) reportada(s)`}</>
                                                            : 'liquidada'}
                                                    </p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {errorPpd && (
                                <p className="mt-3 text-[11px] text-amber-600">
                                    No se pudieron leer las facturas de Facturapi: {errorPpd}
                                </p>
                            )}

                            {cargandoDetalle && (
                                <p className="mt-4 flex items-center gap-2 text-xs text-gray-400">
                                    <Loader size={12} className="animate-spin" /> Leyendo el desglose de impuestos...
                                </p>
                            )}

                            {doc && (
                                <div className="mt-4 p-4 bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-lg space-y-2">
                                    <div className="flex items-center gap-2">
                                        <p className="text-[10px] uppercase tracking-widest text-primary font-bold">Factura seleccionada</p>
                                        {doc.origen === 'externa' && (
                                            <span className="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">otra plataforma</span>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 text-xs">
                                        <div><span className="text-gray-400">Cliente</span><p className="font-medium">{doc.clienteNombre}</p></div>
                                        <div><span className="text-gray-400">RFC</span><p className="font-mono">{doc.clienteRfc}</p></div>
                                        <div><span className="text-gray-400">Folio</span><p className="font-mono font-bold">{etiqueta(doc)}</p></div>
                                        <div><span className="text-gray-400">Total factura</span><p className="font-mono font-bold text-primary">{money(doc.total, doc.moneda)}</p></div>
                                    </div>
                                    <p className="font-mono text-[9px] text-gray-400 break-all">UUID: {doc.uuid}</p>
                                </div>
                            )}
                        </div>

                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-5 flex items-center gap-2">
                                <CreditCard size={15} /> Datos del Pago
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Fecha y Hora del Pago <span className="text-red-500">*</span></label>
                                    <input type="datetime-local" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors" />
                                    <p className="text-[9px] text-gray-400 mt-1">
                                        El REP se presenta a más tardar el día 5 del mes siguiente al del pago.
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Forma de Pago <span className="text-red-500">*</span></label>
                                    <select value={paymentForm} onChange={e => setPaymentForm(e.target.value)} className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors">
                                        {PAYMENT_FORMS.map(pf => <option key={pf.value} value={pf.value}>{pf.label}</option>)}
                                    </select>
                                    <p className="text-[9px] text-gray-400 mt-1">
                                        Es cómo se recibió el dinero, no la “99 – Por definir” de la factura PPD.
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Moneda</label>
                                    <input type="text" readOnly value={doc?.moneda ?? 'MXN'}
                                        className="w-full bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-500" />
                                    <p className="text-[9px] text-gray-400 mt-1">La toma de la factura: el REP se paga en la moneda en que se facturó.</p>
                                </div>
                                {doc && doc.moneda !== 'MXN' && (
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Tipo de Cambio</label>
                                        <input type="number" value={exchange} onChange={e => setExchange(parseFloat(e.target.value) || 1)} step="0.0001" className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary transition-colors" />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Derecha: documento relacionado + resumen */}
                    <div className="space-y-6">
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-5">Documento Relacionado</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
                                        Monto Pagado ({doc?.moneda ?? 'MXN'}) <span className="text-red-500">*</span>
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

                                {/* Parcialidad y saldo NO se capturan: salen del libro de pagos */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Parcialidad</label>
                                        <div className="bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 text-sm font-mono">{parcialidad}</div>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">Saldo anterior</label>
                                        <div className="bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2.5 text-sm font-mono">{money(saldoAnterior, doc?.moneda)}</div>
                                    </div>
                                </div>
                                <p className="text-[9px] text-gray-400">
                                    Los calcula el sistema con los REP ya timbrados de esta factura. Escribirlos a mano
                                    es lo que rompe la parcialidad 2.
                                </p>
                            </div>
                        </div>

                        {/* Desglose */}
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-5">Resumen del Pago</h3>

                            {doc?.estructuraSupuesta && (
                                <div className="mb-4 flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-[11px] text-amber-800 dark:text-amber-200">
                                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                                    <span>
                                        No pude leer el desglose de impuestos de esta factura. El desglose de abajo
                                        <strong> supone</strong> IVA {(IVA_RATE * 100).toFixed(0)}% y ninguna retención.
                                        Verifícalo contra el XML de la factura antes de timbrar.
                                    </span>
                                </div>
                            )}

                            <div className="space-y-3">
                                <div className="flex justify-between text-sm text-gray-500">
                                    <span>Monto Total del Pago</span>
                                    <span className="font-mono font-bold">{money(amountPaid, doc?.moneda)}</span>
                                </div>
                                <div className="flex justify-between text-sm text-gray-500">
                                    <span>Base gravable</span>
                                    <span className="font-mono">{money(desglose.base, doc?.moneda)}</span>
                                </div>
                                {(doc?.impuestos ?? []).map((i, n) => {
                                    const factor = doc && doc.total > 0 ? amountPaid / doc.total : 0;
                                    const importe = redondear(redondear(i.base * factor) * i.tasa);
                                    return (
                                        <div key={n} className="flex justify-between text-sm text-gray-500">
                                            <span>{i.retencion ? `${i.tipo} retenido` : `${i.tipo} trasladado`} ({(i.tasa * 100).toFixed(2)}%)</span>
                                            <span className={`font-mono ${i.retencion ? 'text-amber-600' : 'text-green-600'}`}>
                                                {i.retencion ? '−' : '+'}{money(importe, doc?.moneda)}
                                            </span>
                                        </div>
                                    );
                                })}
                                <div className="flex justify-between text-sm border-t border-gray-100 dark:border-gray-700 pt-3">
                                    <span className="text-gray-500">Suma</span>
                                    <span className={`font-mono font-bold ${descuadre ? 'text-red-500' : 'text-gray-700 dark:text-gray-200'}`}>
                                        {money(desglose.total, doc?.moneda)}
                                    </span>
                                </div>
                                {/* Unos centavos son redondeo y no significan nada; un peso o más
                                    quiere decir que el desglose no corresponde a esta factura. */}
                                {descuadre && (
                                    <p className="text-[11px] text-red-500">
                                        La suma no cuadra con el monto pagado por {money(Math.abs(desglose.diferencia), doc?.moneda)}.
                                        El desglose no corresponde a esta factura: revísalo contra su XML antes de timbrar.
                                    </p>
                                )}
                                <div className="flex justify-between text-sm text-gray-500">
                                    <span>Saldo insoluto</span>
                                    <span className="font-mono font-bold text-primary">{money(Math.max(0, saldoInsoluto), doc?.moneda)}</span>
                                </div>
                            </div>

                            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-lg">
                                <p className="text-[10px] uppercase tracking-widest text-blue-600 dark:text-blue-400 font-bold mb-2">Referencia Factura</p>
                                {doc ? (
                                    <p className="font-mono text-xs text-blue-700 dark:text-blue-300 break-all">{doc.uuid}</p>
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

            {/* ── Historial REP ──────────────────────────────────────────── */}
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
