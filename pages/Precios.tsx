import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../lib/api';
import type { Service, ServiceVariable } from '../types';
import {
    Search, Plus, Save, Loader, AlertCircle, ChevronRight, ChevronDown,
    Archive, RotateCcw, Percent, Clock, Info, DollarSign,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Un precio que nadie ha revisado en medio año ya no es un precio, es un
 *  recuerdo. Seis meses es el umbral donde conviene mirarlo otra vez. */
const DIAS_VIGENCIA = 180;

const TIPOS: { value: 'sustitucion' | 'adicional' | 'opcion'; label: string; efecto: string }[] = [
    { value: 'sustitucion', label: 'Sustitución', efecto: 'REEMPLAZA el precio base' },
    { value: 'adicional',   label: 'Adicional',   efecto: 'SE SUMA al precio base' },
    { value: 'opcion',      label: 'Opción',      efecto: 'no mueve el precio' },
];

const money = (n: number | null | undefined) =>
    n == null ? '—' : `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Margen sobre PRECIO: (precio − costo) / precio. Es la definición que usa
 *  el motor de costeo (precio = costo / (1 − margen)); calcularlo sobre el
 *  costo daría un número mayor y una sensación de ganancia que no existe. */
function margenDe(precio?: number | null, costo?: number | null): number | null {
    if (precio == null || costo == null || precio <= 0) return null;
    return (precio - costo) / precio;
}

function diasDesde(fecha?: string | null): number | null {
    if (!fecha) return null;
    const d = new Date(fecha);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// ---------------------------------------------------------------------------
// Tarifas del taller
// ---------------------------------------------------------------------------

const CAMPOS_TARIFA: { clave: string; label: string; ayuda: string; sufijo?: string; porcentaje?: boolean }[] = [
    { clave: 'mano_obra_hora',   label: 'Mano de obra por hora', ayuda: 'Lo que te CUESTA la hora de taller, no lo que la cobras.', sufijo: '$/h' },
    { clave: 'margen_objetivo',  label: 'Margen objetivo',       ayuda: 'Sobre precio: precio = costo / (1 − margen). Nunca se imprime al cliente.', porcentaje: true },
    { clave: 'canto_maquina_ml', label: 'Cubrecanto a máquina',  ayuda: 'Por metro lineal.', sufijo: '$/ml' },
    { clave: 'canto_manual_ml',  label: 'Cubrecanto a mano',     ayuda: 'El alto brillo 19mm siempre va manual.', sufijo: '$/ml' },
    { clave: 'desperdicio',      label: 'Desperdicio de tablero', ayuda: 'Sobre el área neta de corte.', porcentaje: true },
    { clave: 'iva',              label: 'IVA',                   ayuda: '0.08 = franja fronteriza norte; 0.16 = resto del país.', porcentaje: true },
];

function PanelTarifas({ ajustes, onGuardar }: {
    ajustes: Record<string, any>;
    onGuardar: (clave: string, valor: number) => Promise<void>;
}) {
    const [borrador, setBorrador] = useState<Record<string, string>>({});
    const [guardando, setGuardando] = useState<string | null>(null);

    const valorDe = (c: typeof CAMPOS_TARIFA[number]) => {
        if (borrador[c.clave] !== undefined) return borrador[c.clave];
        const v = Number(ajustes[c.clave] ?? 0);
        return c.porcentaje ? String(+(v * 100).toFixed(4)) : String(v);
    };

    const guardar = async (c: typeof CAMPOS_TARIFA[number]) => {
        const crudo = parseFloat(valorDe(c));
        if (!Number.isFinite(crudo)) return;
        setGuardando(c.clave);
        try {
            await onGuardar(c.clave, c.porcentaje ? crudo / 100 : crudo);
            setBorrador(b => { const n = { ...b }; delete n[c.clave]; return n; });
        } finally { setGuardando(null); }
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-6 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-1 flex items-center gap-2">
                <Percent size={15} /> Tarifas del taller
            </h3>
            <p className="text-xs text-gray-400 mb-5 leading-relaxed">
                De aquí sale el precio cuando se cotiza por costo en lugar de por lista.
                Antes vivían como banderas de línea de comandos: un número que hay que
                recordar cada vez se escribe distinto cada vez.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {CAMPOS_TARIFA.map(c => {
                    const sucio = borrador[c.clave] !== undefined;
                    return (
                        <div key={c.clave}>
                            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1">
                                {c.label}
                            </label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <input
                                        type="number" step="any"
                                        value={valorDe(c)}
                                        onChange={e => setBorrador(b => ({ ...b, [c.clave]: e.target.value }))}
                                        className={`w-full bg-gray-50 dark:bg-gray-900 border ${sucio ? 'border-primary' : 'border-gray-200 dark:border-gray-700'} rounded-lg px-3 py-2 pr-10 text-sm font-mono focus:outline-none focus:border-primary`}
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">
                                        {c.porcentaje ? '%' : c.sufijo}
                                    </span>
                                </div>
                                {sucio && (
                                    <button onClick={() => guardar(c)} disabled={guardando === c.clave}
                                        className="px-3 rounded-lg bg-primary text-white hover:bg-black transition-colors disabled:opacity-50">
                                        {guardando === c.clave ? <Loader size={13} className="animate-spin" /> : <Save size={13} />}
                                    </button>
                                )}
                            </div>
                            <p className="text-[9px] text-gray-400 mt-1 leading-tight">{c.ayuda}</p>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Variantes de un servicio
// ---------------------------------------------------------------------------

interface FilaVarianteProps {
    v: ServiceVariable;
    base: number;
    unidad?: string;
    onGuardar: (v: Partial<ServiceVariable> & { serviceId: string }) => Promise<void>;
    onArchivar: (v: ServiceVariable) => Promise<void>;
}

const FilaVariante: React.FC<FilaVarianteProps> = ({ v, base, unidad, onGuardar, onArchivar }) => {
    const [d, setD] = useState<Partial<ServiceVariable>>({});
    const [guardando, setGuardando] = useState(false);
    const campo = <K extends keyof ServiceVariable>(k: K): any => d[k] !== undefined ? d[k] : v[k];
    const sucio = Object.keys(d).length > 0;

    const kind = campo('kind') as string;
    const price = Number(campo('price')) || 0;

    // Lo que ESTA variante le hace al precio, en pesos y a la vista. Es la
    // diferencia entre una cocina de $1,450/ml y una de $4,300/ml, y hasta
    // ahora esa decisión estaba escondida en una columna que nadie veía.
    const resultado = kind === 'sustitucion' ? price
        : kind === 'adicional' ? base + price
        : base;

    const guardar = async () => {
        setGuardando(true);
        try { await onGuardar({ ...v, ...d, serviceId: v.serviceId }); setD({}); }
        finally { setGuardando(false); }
    };

    return (
        <tr className={`text-sm ${v.active ? '' : 'opacity-40'}`}>
            <td className="py-2 pl-10 pr-2">
                <input value={campo('name') ?? ''} onChange={e => setD({ ...d, name: e.target.value })}
                    className="w-full bg-transparent border-b border-transparent hover:border-gray-200 focus:border-primary focus:outline-none text-sm py-0.5" />
            </td>
            <td className="py-2 px-2">
                <select value={kind} onChange={e => setD({ ...d, kind: e.target.value as any })}
                    className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-xs focus:outline-none focus:border-primary">
                    {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
            </td>
            <td className="py-2 px-2 text-right">
                <input type="number" step="any" value={campo('price') ?? ''}
                    onChange={e => setD({ ...d, price: e.target.value === '' ? null : parseFloat(e.target.value) })}
                    className="w-24 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-primary focus:outline-none text-sm text-right font-mono py-0.5" />
            </td>
            <td className="py-2 px-2 text-right">
                <input type="number" step="any" value={campo('cost') ?? ''} placeholder="—"
                    onChange={e => setD({ ...d, cost: e.target.value === '' ? null : parseFloat(e.target.value) })}
                    className="w-24 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-primary focus:outline-none text-sm text-right font-mono py-0.5" />
            </td>
            <td className="py-2 px-2 text-right">
                {/* La cuenta completa, a la vista: base + variante = lo que se cobra */}
                <span className={`font-mono text-xs ${kind === 'sustitucion' && price < base ? 'text-amber-600 font-bold' : 'text-gray-500'}`}>
                    {money(resultado)}{unidad ? <span className="text-gray-400">/{unidad}</span> : null}
                </span>
                {kind === 'sustitucion' && price > 0 && price < base && (
                    <p className="text-[9px] text-amber-600 leading-tight max-w-[150px] ml-auto">
                        Baja el precio base de {money(base)}. ¿No debería ser adicional?
                    </p>
                )}
            </td>
            <td className="py-2 px-2">
                <div className="flex items-center justify-end gap-1">
                    {sucio && (
                        <button onClick={guardar} disabled={guardando}
                            className="px-2 py-1 rounded bg-primary text-white hover:bg-black transition-colors disabled:opacity-50">
                            {guardando ? <Loader size={11} className="animate-spin" /> : <Save size={11} />}
                        </button>
                    )}
                    <button onClick={() => onArchivar(v)} title={v.active ? 'Archivar' : 'Reactivar'}
                        className="p-1 text-gray-300 hover:text-gray-600 transition-colors">
                        {v.active ? <Archive size={12} /> : <RotateCcw size={12} />}
                    </button>
                </div>
            </td>
        </tr>
    );
};

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

const Precios: React.FC = () => {
    const [servicios, setServicios] = useState<Service[]>([]);
    const [variantes, setVariantes] = useState<ServiceVariable[]>([]);
    const [ajustes, setAjustes] = useState<Record<string, any>>({});
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busqueda, setBusqueda] = useState('');
    const [verArchivados, setVerArchivados] = useState(false);
    const [abierto, setAbierto] = useState<string | null>(null);
    const [borrador, setBorrador] = useState<Record<string, Partial<Service>>>({});
    const [guardando, setGuardando] = useState<string | null>(null);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);
        try {
            const [s, v, a] = await Promise.all([
                api.getServices(true), api.getServiceVariables(true), api.getAjustes(),
            ]);
            setServicios(s); setVariantes(v); setAjustes(a);
        } catch (e: any) {
            setError(`${e.message}. Si dice que falta una columna, corre supabase/migrations/20260808_master_list.sql y 20260924_tarifas.sql.`);
        } finally { setCargando(false); }
    }, []);

    useEffect(() => { cargar(); }, [cargar]);

    const visibles = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        return servicios
            .filter(s => verArchivados || s.active !== false)
            .filter(s => !q || s.name.toLowerCase().includes(q) ||
                         (s.category ?? '').toLowerCase().includes(q) ||
                         (s.sku ?? '').toLowerCase().includes(q));
    }, [servicios, busqueda, verArchivados]);

    // Lo que hay que atender, contado. Un aviso sin número no mueve a nadie.
    const pendientes = useMemo(() => {
        const activos = servicios.filter(s => s.active !== false);
        const sinCosto = activos.filter(s => s.cost == null).length;
        const viejos = activos.filter(s => {
            const d = diasDesde(s.priceUpdatedAt);
            return d == null || d > DIAS_VIGENCIA;
        }).length;
        // Variantes que ABARATAN el servicio siendo sustitución: casi siempre
        // son adicionales mal clasificados, y cotizan de menos.
        const sospechosas = variantes.filter(v => {
            if (v.active === false || v.kind !== 'sustitucion') return false;
            const s = servicios.find(x => x.id === v.serviceId);
            return !!s && !!v.price && v.price > 0 && v.price < (s.basePrice || 0);
        }).length;
        return { sinCosto, viejos, sospechosas, total: activos.length };
    }, [servicios, variantes]);

    const guardarServicio = async (s: Service) => {
        setGuardando(s.id);
        try {
            await api.upsertService({ ...s, ...borrador[s.id] });
            setBorrador(b => { const n = { ...b }; delete n[s.id]; return n; });
            await cargar();
        } catch (e: any) { alert('No se pudo guardar: ' + e.message); }
        finally { setGuardando(null); }
    };

    const nuevoServicio = async () => {
        const name = prompt('Nombre del servicio nuevo:');
        if (!name?.trim()) return;
        try { await api.upsertService({ name: name.trim(), basePrice: 0, active: true }); await cargar(); }
        catch (e: any) { alert('No se pudo crear: ' + e.message); }
    };

    const nuevaVariante = async (s: Service) => {
        const name = prompt(`Nombre de la variante para "${s.name}":`);
        if (!name?.trim()) return;
        try {
            await api.upsertServiceVariable({
                serviceId: s.id, name: name.trim(), kind: 'adicional' as any,
                price: 0, active: true, sortOrder: 0,
            });
            await cargar();
        } catch (e: any) { alert('No se pudo crear: ' + e.message); }
    };

    if (cargando) {
        return (
            <div className="max-w-7xl mx-auto space-y-4">
                {[1, 2, 3, 4].map(i => <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />)}
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-8 pb-12 animate-fade-in">
            <div className="border-b border-gray-200 dark:border-gray-700 pb-6">
                <div className="flex justify-between items-start flex-wrap gap-4">
                    <div>
                        <h1 className="font-serif text-4xl dark:text-white text-primary mb-2">Precios</h1>
                        <p className="text-xs font-mono uppercase tracking-widest text-gray-400">
                            Lista maestra · servicios, componentes y tarifas
                        </p>
                    </div>
                    <button onClick={nuevoServicio}
                        className="flex items-center gap-2 px-6 py-3 bg-primary text-white text-xs uppercase tracking-widest font-bold shadow-lg hover:bg-primary/90 transition-colors rounded-lg">
                        <Plus size={16} /> Servicio nuevo
                    </button>
                </div>
            </div>

            {error && (
                <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl text-sm text-red-700 dark:text-red-300">
                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" /><span>{error}</span>
                </div>
            )}

            {/* Lo que hay que atender */}
            {(pendientes.sinCosto > 0 || pendientes.viejos > 0 || pendientes.sospechosas > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {pendientes.sospechosas > 0 && (
                        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                            <p className="text-2xl font-serif text-amber-700 dark:text-amber-300">{pendientes.sospechosas}</p>
                            <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-snug mt-1">
                                variante(s) marcadas como <strong>sustitución</strong> que cuestan
                                MENOS que su servicio. Elegirlas <strong>abarata</strong> la cotización.
                                Casi siempre son adicionales mal clasificados.
                            </p>
                        </div>
                    )}
                    {pendientes.sinCosto > 0 && (
                        <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
                            <p className="text-2xl font-serif text-gray-700 dark:text-gray-300">{pendientes.sinCosto}<span className="text-sm text-gray-400">/{pendientes.total}</span></p>
                            <p className="text-[11px] text-gray-500 leading-snug mt-1">
                                servicio(s) sin <strong>costo</strong> cargado. Sin costo no hay margen:
                                precio menos costo es la única cifra que dice si ganas.
                            </p>
                        </div>
                    )}
                    {pendientes.viejos > 0 && (
                        <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
                            <p className="text-2xl font-serif text-gray-700 dark:text-gray-300">{pendientes.viejos}</p>
                            <p className="text-[11px] text-gray-500 leading-snug mt-1">
                                precio(s) sin revisar en más de {DIAS_VIGENCIA} días. Un precio viejo
                                se ve igual que uno de ayer.
                            </p>
                        </div>
                    )}
                </div>
            )}

            <PanelTarifas
                ajustes={ajustes}
                onGuardar={async (clave, valor) => {
                    await api.setAjuste(clave, valor);
                    setAjustes(a => ({ ...a, [clave]: valor }));
                }}
            />

            {/* Buscador */}
            <div className="flex flex-wrap gap-4 items-center">
                <div className="relative flex-1 min-w-[220px]">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" placeholder="Buscar servicio, categoría o SKU..." value={busqueda}
                        onChange={e => setBusqueda(e.target.value)}
                        className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:border-primary" />
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                    <input type="checkbox" checked={verArchivados} onChange={e => setVerArchivados(e.target.checked)} />
                    Ver archivados
                </label>
            </div>

            {/* Tabla */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-x-auto shadow-sm">
                <table className="w-full text-sm min-w-[860px]">
                    <thead>
                        <tr className="border-b border-gray-100 dark:border-gray-700 text-[10px] uppercase tracking-widest text-gray-400">
                            <th className="px-5 py-3 text-left">Servicio</th>
                            <th className="px-2 py-3 text-left">Unidad</th>
                            <th className="px-2 py-3 text-right">Precio</th>
                            <th className="px-2 py-3 text-right">Costo</th>
                            <th className="px-2 py-3 text-right">Margen</th>
                            <th className="px-2 py-3 text-center">Revisado</th>
                            <th className="px-2 py-3"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                        {visibles.length === 0 && (
                            <tr><td colSpan={7} className="py-16 text-center text-gray-400 italic text-sm">
                                Sin servicios que coincidan.
                            </td></tr>
                        )}
                        {visibles.map(s => {
                            const d = borrador[s.id] ?? {};
                            const campo = <K extends keyof Service>(k: K): any => d[k] !== undefined ? d[k] : s[k];
                            const sucio = Object.keys(d).length > 0;
                            const precio = Number(campo('basePrice')) || 0;
                            const costo = campo('cost');
                            const m = margenDe(precio, costo == null ? null : Number(costo));
                            const dias = diasDesde(s.priceUpdatedAt);
                            const misVariantes = variantes
                                .filter(v => v.serviceId === s.id)
                                .filter(v => verArchivados || v.active !== false);
                            const expandido = abierto === s.id;

                            return (
                                <React.Fragment key={s.id}>
                                    <tr className={`hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors ${s.active === false ? 'opacity-40' : ''}`}>
                                        <td className="px-5 py-3">
                                            <div className="flex items-start gap-2">
                                                <button onClick={() => setAbierto(expandido ? null : s.id)}
                                                    className="mt-1 text-gray-400 hover:text-primary transition-colors">
                                                    {expandido ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                </button>
                                                <div className="flex-1">
                                                    <input value={campo('name') ?? ''}
                                                        onChange={e => setBorrador(b => ({ ...b, [s.id]: { ...d, name: e.target.value } }))}
                                                        className="w-full bg-transparent border-b border-transparent hover:border-gray-200 focus:border-primary focus:outline-none font-medium py-0.5" />
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <span className="text-[10px] text-gray-400">{s.category || 'sin categoría'}</span>
                                                        {misVariantes.length > 0 && (
                                                            <span className="text-[10px] px-1.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">
                                                                {misVariantes.length} variante(s)
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-2 py-3">
                                            <input value={campo('units') ?? ''} placeholder="ml / pz"
                                                onChange={e => setBorrador(b => ({ ...b, [s.id]: { ...d, units: e.target.value } }))}
                                                className="w-20 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-primary focus:outline-none text-xs py-0.5" />
                                        </td>
                                        <td className="px-2 py-3 text-right">
                                            <input type="number" step="any" value={campo('basePrice') ?? ''}
                                                onChange={e => setBorrador(b => ({ ...b, [s.id]: { ...d, basePrice: parseFloat(e.target.value) } }))}
                                                className="w-28 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-primary focus:outline-none text-right font-mono py-0.5" />
                                        </td>
                                        <td className="px-2 py-3 text-right">
                                            <input type="number" step="any" value={campo('cost') ?? ''} placeholder="—"
                                                onChange={e => setBorrador(b => ({ ...b, [s.id]: { ...d, cost: e.target.value === '' ? null : parseFloat(e.target.value) } }))}
                                                className="w-28 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-primary focus:outline-none text-right font-mono py-0.5" />
                                        </td>
                                        <td className="px-2 py-3 text-right">
                                            {m == null ? (
                                                <span className="text-[10px] text-gray-300 italic">sin costo</span>
                                            ) : (
                                                <span className={`font-mono text-sm font-bold ${m < 0 ? 'text-red-500' : m < 0.2 ? 'text-amber-600' : 'text-green-600'}`}>
                                                    {(m * 100).toFixed(1)}%
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-2 py-3 text-center">
                                            {dias == null ? (
                                                <span className="text-[10px] text-gray-300 italic">nunca</span>
                                            ) : (
                                                <span className={`text-[10px] font-mono ${dias > DIAS_VIGENCIA ? 'text-amber-600 font-bold' : 'text-gray-400'}`}>
                                                    {dias}d
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-2 py-3">
                                            <div className="flex items-center justify-end gap-1">
                                                {sucio && (
                                                    <button onClick={() => guardarServicio(s)} disabled={guardando === s.id}
                                                        className="px-2 py-1 rounded bg-primary text-white hover:bg-black transition-colors disabled:opacity-50">
                                                        {guardando === s.id ? <Loader size={11} className="animate-spin" /> : <Save size={11} />}
                                                    </button>
                                                )}
                                                <button
                                                    onClick={async () => {
                                                        await api.archivarServicio(s.id, s.active === false);
                                                        await cargar();
                                                    }}
                                                    title={s.active === false ? 'Reactivar' : 'Archivar'}
                                                    className="p-1 text-gray-300 hover:text-gray-600 transition-colors">
                                                    {s.active === false ? <RotateCcw size={13} /> : <Archive size={13} />}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>

                                    {expandido && (
                                        <tr className="bg-gray-50/60 dark:bg-gray-900/40">
                                            <td colSpan={7} className="px-5 py-4">
                                                <div className="flex items-center justify-between mb-3">
                                                    <p className="text-[10px] uppercase tracking-widest text-gray-400">
                                                        Variantes de {s.name}
                                                    </p>
                                                    <button onClick={() => nuevaVariante(s)}
                                                        className="flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-primary hover:text-black transition-colors">
                                                        <Plus size={11} /> Agregar
                                                    </button>
                                                </div>

                                                <div className="flex items-start gap-2 mb-3 text-[11px] text-gray-500 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg p-3">
                                                    <Info size={13} className="flex-shrink-0 mt-0.5 text-gray-400" />
                                                    <span>
                                                        {TIPOS.map(t => `${t.label}: ${t.efecto}`).join(' · ')}.
                                                        La columna <strong>Resultado</strong> muestra lo que se cobraría
                                                        por {s.units || 'unidad'} al elegir esa variante.
                                                    </span>
                                                </div>

                                                {misVariantes.length === 0 ? (
                                                    <p className="text-xs text-gray-400 italic py-2">Sin variantes.</p>
                                                ) : (
                                                    <table className="w-full">
                                                        <thead>
                                                            <tr className="text-[9px] uppercase tracking-widest text-gray-400">
                                                                <th className="pl-10 pr-2 py-1 text-left">Variante</th>
                                                                <th className="px-2 py-1 text-left">Tipo</th>
                                                                <th className="px-2 py-1 text-right">Precio</th>
                                                                <th className="px-2 py-1 text-right">Costo</th>
                                                                <th className="px-2 py-1 text-right">Resultado</th>
                                                                <th className="px-2 py-1"></th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/40">
                                                            {misVariantes.map(v => (
                                                                <FilaVariante
                                                                    key={v.id} v={v} base={precio} unidad={s.units}
                                                                    onGuardar={async payload => { await api.upsertServiceVariable(payload as any); await cargar(); }}
                                                                    onArchivar={async vv => { await api.archivarVariante(vv.id, vv.active === false); await cargar(); }}
                                                                />
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <p className="text-[11px] text-gray-400 flex items-center gap-2">
                <Clock size={12} />
                Cada vez que guardas un servicio se sella la fecha de revisión. El margen
                se calcula sobre precio y <strong>nunca</strong> sale en un documento del cliente.
            </p>
        </div>
    );
};

export default Precios;
