/**
 * Revisión de la ficha que el modelo leyó de una foto de referencia.
 *
 * Es el punto donde un humano confirma antes de construir: una foto no trae
 * escala y una hecha con IA miente. Aquí se corrigen las medidas estimadas,
 * se agregan indicaciones, y sólo entonces se encola la construcción. Lo que
 * se aprueba aquí es lo que el constructor recibe; la foto ya no.
 */
import React, { useMemo, useState } from 'react';
import { AlertTriangle, Hammer, Loader2, Ruler, X, Lightbulb, Ban } from 'lucide-react';
import { FichaLectura as Ficha, ForgeJob } from '../types';

const NOMBRE_TIPO: Record<string, string> = {
    gabinete_base: 'Gabinete de piso',
    cajonera: 'Cajonera',
    tarja: 'Módulo de tarja',
    torre: 'Torre',
    alacena: 'Alacena',
    hueco: 'Hueco',
    closet_colgado_sencillo: 'Colgado sencillo',
    closet_colgado_doble: 'Colgado doble',
    closet_entrepanos: 'Entrepaños',
    closet_cajonera: 'Cajonera de closet',
    closet_zapatera: 'Zapatera',
    closet_vitrina: 'Vitrina',
    closet_maletero: 'Maletero',
    esquinero: 'Esquinero',
    repisa_abierta: 'Repisa abierta',
    isla: 'Isla',
    panel_decorativo: 'Panel decorativo',
    otro: 'Otro',
};

const Etiqueta: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="text-[10px] font-mono uppercase tracking-widest text-gray-400 mb-2">{children}</p>
);

interface Props {
    job: ForgeJob;
    onConstruir: (ficha: Ficha) => Promise<void>;
    onCerrar: () => void;
}

const FichaLectura: React.FC<Props> = ({ job, onConstruir, onCerrar }) => {
    const ficha = job.ficha!;
    const [valores, setValores] = useState<Record<string, string>>(() =>
        Object.fromEntries(ficha.medidas.map(m =>
            [m.clave, String(m.valor_mm ?? Math.round(m.estimado_mm))])));
    const [indicaciones, setIndicaciones] = useState(ficha.indicaciones || '');
    const [enviando, setEnviando] = useState(false);

    const omitidos = useMemo(() => new Set(ficha.omitidos || []), [ficha.omitidos]);
    const medidaInvalida = ficha.medidas.some(m => !(Number(valores[m.clave]) > 0));

    const construir = async () => {
        setEnviando(true);
        try {
            await onConstruir({
                ...ficha,
                medidas: ficha.medidas.map(m => ({ ...m, valor_mm: Number(valores[m.clave]) })),
                indicaciones: indicaciones.trim(),
            });
        } finally {
            setEnviando(false);
        }
    };

    return (
        <div className="border border-primary/40 dark:border-gray-600 bg-gray-50/60 dark:bg-gray-900/40 p-5 space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <Etiqueta>Ficha de lectura · revisar antes de construir</Etiqueta>
                    <h3 className="font-serif text-2xl italic dark:text-white">{ficha.nombre_proyecto}</h3>
                    <p className="text-[11px] font-mono uppercase tracking-widest text-gray-400 mt-1">
                        {ficha.tipo} · {ficha.distribucion}
                        {ficha.cliente ? ` · ${ficha.cliente}` : ''}
                    </p>
                </div>
                <button onClick={onCerrar} title="Cerrar" className="text-gray-400 hover:text-danger p-1">
                    <X size={16} />
                </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
                {!!job.imagenes?.length && (
                    <div className="flex gap-2 shrink-0">
                        {job.imagenes.slice(0, 3).map(u => (
                            <a key={u} href={u} target="_blank" rel="noopener noreferrer">
                                <img src={u} alt="Referencia"
                                     className="w-24 h-24 object-cover border border-gray-200 dark:border-gray-600" />
                            </a>
                        ))}
                    </div>
                )}
                <p className="text-sm text-gray-600 dark:text-gray-300">{ficha.resumen}</p>
            </div>

            {!ficha.construible && (
                <div className="flex gap-3 border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3 text-sm text-amber-800 dark:text-amber-200">
                    <Ban size={16} className="shrink-0 mt-0.5" />
                    <span>
                        El motor todavía no tiene generador para esto
                        ({(ficha.omitidos || []).map(t => NOMBRE_TIPO[t] || t).join(', ')}).
                        La ficha sirve de levantamiento; la construcción queda para cuando exista el generador.
                    </span>
                </div>
            )}

            {/* Elementos por muro */}
            <div className="space-y-4">
                {ficha.muros.map(muro => (
                    <div key={muro.id}>
                        <Etiqueta>Muro {muro.id} · {muro.descripcion} · izquierda → derecha</Etiqueta>
                        <div className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                            {muro.elementos.map((e, i) => {
                                const sin = omitidos.has(e.tipo);
                                const piezas = [
                                    `~${Math.round(e.ancho_estimado_mm)} mm`,
                                    e.puertas ? `${e.puertas} puerta(s)` : '',
                                    e.cajones ? `${e.cajones} cajón(es)` : '',
                                    e.entrepanos ? `${e.entrepanos} entrepaño(s)` : '',
                                    e.led ? 'LED' : '',
                                ].filter(Boolean).join(' · ');
                                return (
                                    <div key={i} className="px-3 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                                        <span className="font-medium dark:text-white">{NOMBRE_TIPO[e.tipo] || e.tipo}</span>
                                        <span className="text-[11px] font-mono text-gray-400">{piezas}</span>
                                        {sin && (
                                            <span className="text-[10px] font-mono uppercase tracking-widest text-amber-600">
                                                sin generador
                                            </span>
                                        )}
                                        {e.detalle && (
                                            <span className="basis-full text-[12px] text-gray-500 dark:text-gray-400">{e.detalle}</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                <div>
                    <Etiqueta>Acabados y apertura</Etiqueta>
                    <ul className="space-y-1 text-gray-600 dark:text-gray-300">
                        {ficha.acabados.map((a, i) => (
                            <li key={i}>
                                <span className="text-gray-400">{a.zona}:</span> {a.descripcion}
                                {a.sku_sugerido && <span className="font-mono text-[11px] text-gray-400"> · {a.sku_sugerido}</span>}
                            </li>
                        ))}
                        <li><span className="text-gray-400">apertura:</span> {ficha.apertura.replace('_', ' ')}</li>
                        {ficha.led?.lleva && (
                            <li className="flex items-center gap-1">
                                <Lightbulb size={13} className="text-gray-400" /> LED en {ficha.led.zonas.join(', ')}
                            </li>
                        )}
                    </ul>
                </div>
                {ficha.supuestos.length > 0 && (
                    <div>
                        <Etiqueta>Lo que se dio por hecho</Etiqueta>
                        <ul className="list-disc pl-4 space-y-1 text-gray-600 dark:text-gray-300">
                            {ficha.supuestos.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                    </div>
                )}
            </div>

            {ficha.no_fabricable.length > 0 && (
                <div>
                    <Etiqueta>No se fabrica como en la foto</Etiqueta>
                    <ul className="space-y-2 text-sm">
                        {ficha.no_fabricable.map((x, i) => (
                            <li key={i} className="flex gap-2">
                                <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                                <span className="text-gray-600 dark:text-gray-300">
                                    <b className="font-medium dark:text-white">{x.elemento}</b> — {x.por_que}
                                    <span className="block text-gray-500 dark:text-gray-400">Propuesta: {x.propuesta}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Medidas: lo único que la foto no puede dar */}
            <div>
                <Etiqueta>Medidas · confirma o corrige (mm)</Etiqueta>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {ficha.medidas.map(m => (
                        <label key={m.clave} className="block">
                            <span className="text-sm text-gray-700 dark:text-gray-200">{m.pregunta}</span>
                            <div className="flex items-center gap-2 mt-1">
                                <Ruler size={14} className="text-gray-400 shrink-0" />
                                <input
                                    type="number" min={1} step={10} inputMode="numeric"
                                    value={valores[m.clave] ?? ''}
                                    onChange={ev => setValores(v => ({ ...v, [m.clave]: ev.target.value }))}
                                    className="w-32 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm font-mono dark:text-white focus:border-primary outline-none"
                                />
                            </div>
                            <span className="text-[11px] text-gray-400">
                                Estimado {Math.round(m.estimado_mm)} mm · {m.base}
                            </span>
                        </label>
                    ))}
                </div>
            </div>

            <div>
                <Etiqueta>Indicaciones para el constructor</Etiqueta>
                <textarea
                    value={indicaciones}
                    onChange={e => setIndicaciones(e.target.value)}
                    rows={2}
                    placeholder="Ej: frentes en melamina rosa, sin LED en la zapatera, fondo de 550"
                    className="w-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 p-3 text-sm dark:text-white focus:border-primary outline-none resize-y"
                />
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <button
                    onClick={construir}
                    disabled={enviando || !ficha.construible || medidaInvalida}
                    className="bg-primary text-white px-6 py-3 flex items-center gap-2 text-xs uppercase tracking-widest disabled:opacity-40"
                >
                    {enviando ? <Loader2 size={16} className="animate-spin" /> : <Hammer size={16} />}
                    Construir diseño
                </button>
                <span className="text-[11px] text-gray-400">
                    {!ficha.construible
                        ? 'Sin generador para este tipo de mueble.'
                        : medidaInvalida
                            ? 'Todas las medidas deben ser mayores que cero.'
                            : ficha.omitidos?.length
                                ? `Se construye todo menos: ${ficha.omitidos.map(t => NOMBRE_TIPO[t] || t).join(', ')}.`
                                : 'Se construye con estas medidas; la foto ya no se usa.'}
                </span>
            </div>
        </div>
    );
};

export default FichaLectura;
