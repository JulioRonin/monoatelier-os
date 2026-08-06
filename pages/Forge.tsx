/**
 * FORGE — puente entre el motor paramétrico mono-forge y la plataforma.
 *
 * Flujo: el CLI de mono-forge genera project.json (con colocación 3D) →
 * aquí se importa, se visualiza en 3D, se guarda en Supabase y se publica
 * en AR: el navegador genera GLB (Android) y USDZ (iOS) a escala real,
 * los sube al bucket 'forge' y entrega un QR para abrirlo en el teléfono.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Hammer, Upload, Smartphone, Trash2, Loader2, Box, QrCode,
    CheckCircle2, RefreshCw, FlaskConical, X
} from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../lib/api';
import { ForgeModel } from '../types';
import ForgeViewer from '../components/ForgeViewer';
import {
    ForgeProjectData, construirProyecto, exportarGLB, exportarUSDZ,
    resumenProyecto, tieneColocacion
} from '../lib/forge3d';

const Forge: React.FC = () => {
    const [models, setModels] = useState<ForgeModel[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<ForgeModel | null>(null);
    const [publishing, setPublishing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [importData, setImportData] = useState<ForgeProjectData | null>(null);
    const [importName, setImportName] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);
    const darkMode = typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getForgeModels();
            setModels(data);
        } catch (e: any) {
            console.error(e);
            setError('No se pudieron cargar los diseños. ¿Corriste la migración 20260806_forge_models.sql?');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // QR del visor AR público del diseño seleccionado
    useEffect(() => {
        setQrDataUrl(null);
        if (!selected) return;
        const url = arUrl(selected.id);
        QRCode.toDataURL(url, { width: 260, margin: 1 }).then(setQrDataUrl).catch(console.error);
    }, [selected?.id]);

    const arUrl = (id: string) =>
        `${window.location.origin}${window.location.pathname}?ar=${id}`;

    // ── Importar project.json ────────────────────────────────────────
    const onFile = async (file: File) => {
        setError(null);
        try {
            const data = JSON.parse(await file.text()) as ForgeProjectData;
            if (!data.modules?.length) throw new Error('El JSON no tiene módulos.');
            if (!tieneColocacion(data)) {
                setError('Este project.json no trae colocación 3D. Regenéralo con: '
                    + 'python -m mono_forge.cli <PRESET> --out projects/x (versión actual del motor).');
                return;
            }
            setImportData(data);
            setImportName(data.nombre || file.name.replace(/\.json$/i, ''));
            setSelected(null);
        } catch (e: any) {
            setError(`No se pudo leer el project.json: ${e.message}`);
        }
    };

    const cargarDemo = async () => {
        setError(null);
        try {
            const res = await fetch('/forge-demo.json');
            const data = await res.json() as ForgeProjectData;
            setImportData(data);
            setImportName(`${data.nombre} (demo)`);
            setSelected(null);
        } catch {
            setError('No se encontró el demo (public/forge-demo.json).');
        }
    };

    const guardarImport = async () => {
        if (!importData) return;
        setSaving(true);
        setError(null);
        try {
            const created = await api.createForgeModel({
                name: importName || importData.nombre,
                description: `${importData.cliente} — ${importData.modules.length} módulos`,
                projectJson: importData,
            });
            // sube también el JSON como respaldo del entregable
            await api.uploadForgeAsset(created.id, 'project.json',
                new Blob([JSON.stringify(importData)], { type: 'application/json' }),
                'application/json');
            setImportData(null);
            await load();
            setSelected(created);
        } catch (e: any) {
            setError(`No se pudo guardar: ${e.message}`);
        } finally {
            setSaving(false);
        }
    };

    // ── Publicar AR: genera GLB + USDZ en el navegador y los sube ────
    const publicarAR = async (model: ForgeModel) => {
        setPublishing(true);
        setError(null);
        try {
            const group = construirProyecto(model.projectJson as ForgeProjectData);
            const glb = await exportarGLB(group);
            const glbUrl = await api.uploadForgeAsset(model.id, 'preview.glb', glb, 'model/gltf-binary');

            let usdzUrl: string | null = null;
            try {
                const usdz = await exportarUSDZ(group);
                usdzUrl = await api.uploadForgeAsset(model.id, 'preview.usdz', usdz, 'model/vnd.usdz+zip');
            } catch (e) {
                console.warn('USDZ no disponible:', e);
            }

            await api.updateForgeModel(model.id, { glbUrl, usdzUrl, status: 'published' });
            await load();
            setSelected({ ...model, glbUrl, usdzUrl, status: 'published' });
        } catch (e: any) {
            setError(`No se pudo publicar en AR: ${e.message}`);
        } finally {
            setPublishing(false);
        }
    };

    const borrar = async (model: ForgeModel) => {
        if (!confirm(`¿Eliminar el diseño "${model.name}"?`)) return;
        try {
            await api.deleteForgeModel(model.id);
            if (selected?.id === model.id) setSelected(null);
            await load();
        } catch (e: any) {
            setError(`No se pudo eliminar: ${e.message}`);
        }
    };

    const activeData: ForgeProjectData | null =
        importData || (selected?.projectJson as ForgeProjectData) || null;
    const resumen = activeData ? resumenProyecto(activeData) : null;

    return (
        <div className="space-y-12 animate-fade-in">
            {/* Header */}
            <div className="flex justify-between items-end pb-6 border-b border-gray-100 dark:border-gray-800">
                <div>
                    <p className="text-xs font-mono uppercase tracking-widest text-gray-400 mb-2">
                        Motor paramétrico · mono-forge
                    </p>
                    <h1 className="font-serif text-4xl italic dark:text-white">The Forge</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-xl">
                        Diseños con medidas reales generados desde el motor. Visualízalos en 3D,
                        publícalos en AR y ábrelos en tu teléfono con el QR.
                    </p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={cargarDemo}
                        className="border border-primary text-primary dark:text-white dark:border-gray-600 px-6 py-3 flex items-center gap-2 text-xs uppercase tracking-widest hover:bg-primary hover:text-white transition-colors"
                    >
                        <FlaskConical size={16} /> Demo
                    </button>
                    <button
                        onClick={() => fileRef.current?.click()}
                        className="bg-primary text-white px-8 py-3 flex items-center gap-2 text-xs uppercase tracking-widest hover:opacity-90 transition-opacity"
                    >
                        <Upload size={16} /> Importar project.json
                    </button>
                    <input
                        ref={fileRef} type="file" accept=".json,application/json" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
                    />
                </div>
            </div>

            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-danger dark:text-red-300 px-6 py-4 text-sm flex justify-between items-center">
                    <span>{error}</span>
                    <button onClick={() => setError(null)}><X size={16} /></button>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Listado */}
                <div className="space-y-4">
                    <p className="text-xs font-mono uppercase tracking-widest text-gray-400">
                        Diseños ({models.length})
                    </p>
                    {loading ? (
                        <div className="flex items-center gap-3 text-gray-400 text-sm py-8">
                            <Loader2 size={18} className="animate-spin" /> Cargando…
                        </div>
                    ) : models.length === 0 && !importData ? (
                        <div className="border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-400">
                            <Box size={32} className="mx-auto mb-3 opacity-40" />
                            Sin diseños todavía. Genera uno con el motor:
                            <code className="block mt-3 text-[11px] bg-gray-50 dark:bg-gray-800 p-2 text-left overflow-x-auto">
                                python -m mono_forge.cli BASE-600 SUP-750 --out projects/mi-cocina
                            </code>
                            …e importa el <b>project.json</b>, o prueba el <b>Demo</b>.
                        </div>
                    ) : (
                        models.map(m => (
                            <button
                                key={m.id}
                                onClick={() => { setImportData(null); setSelected(m); }}
                                className={`w-full text-left p-5 border transition-all ${selected?.id === m.id
                                    ? 'border-primary bg-white dark:bg-gray-800 shadow-md'
                                    : 'border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/60 hover:border-primary'}`}
                            >
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="font-medium dark:text-white">{m.name}</p>
                                        <p className="text-xs text-gray-400 mt-1">{m.description}</p>
                                    </div>
                                    {m.status === 'published' ? (
                                        <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-primary dark:text-success">
                                            <CheckCircle2 size={12} /> AR
                                        </span>
                                    ) : (
                                        <span className="text-[10px] font-mono uppercase tracking-widest text-gray-400">
                                            draft
                                        </span>
                                    )}
                                </div>
                            </button>
                        ))
                    )}
                </div>

                {/* Visor + acciones */}
                <div className="lg:col-span-2 space-y-6">
                    {activeData ? (
                        <>
                            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
                                <ForgeViewer data={activeData} darkMode={darkMode} className="w-full h-[440px]" />
                            </div>

                            {resumen && (
                                <div className="grid grid-cols-4 gap-4 text-center">
                                    {[
                                        [resumen.modulos, 'Módulos'],
                                        [resumen.paneles, 'Paneles'],
                                        [`${resumen.areaM2} m²`, 'Área tablero'],
                                        [`${resumen.anchoTotalMm} mm`, 'Frente total'],
                                    ].map(([v, l]) => (
                                        <div key={l as string} className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 py-4">
                                            <p className="font-serif text-2xl dark:text-white">{v}</p>
                                            <p className="text-[10px] font-mono uppercase tracking-widest text-gray-400 mt-1">{l}</p>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {importData ? (
                                /* Guardar importación */
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-6 flex items-end gap-4">
                                    <div className="flex-1">
                                        <label className="text-[10px] font-mono uppercase tracking-widest text-gray-400 block mb-2">
                                            Nombre del diseño
                                        </label>
                                        <input
                                            value={importName}
                                            onChange={e => setImportName(e.target.value)}
                                            className="w-full border-b border-gray-300 dark:border-gray-600 bg-transparent py-2 text-sm dark:text-white focus:border-primary outline-none"
                                        />
                                    </div>
                                    <button
                                        onClick={guardarImport}
                                        disabled={saving}
                                        className="bg-primary text-white px-8 py-3 flex items-center gap-2 text-xs uppercase tracking-widest disabled:opacity-50"
                                    >
                                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Hammer size={16} />}
                                        Guardar en Forge
                                    </button>
                                    <button
                                        onClick={() => setImportData(null)}
                                        className="border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-300 px-6 py-3 text-xs uppercase tracking-widest"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            ) : selected && (
                                /* Acciones del diseño guardado */
                                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-6">
                                    <div className="flex flex-wrap items-start gap-8">
                                        <div className="flex-1 min-w-[260px] space-y-4">
                                            <p className="text-[10px] font-mono uppercase tracking-widest text-gray-400">
                                                Realidad aumentada
                                            </p>
                                            {selected.status !== 'published' || !selected.glbUrl ? (
                                                <>
                                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                                        Publica el diseño para verlo a escala real en tu teléfono:
                                                        se generan el GLB (Android) y el USDZ (iOS) y se suben al storage.
                                                    </p>
                                                    <button
                                                        onClick={() => publicarAR(selected)}
                                                        disabled={publishing}
                                                        className="bg-primary text-white px-8 py-3 flex items-center gap-2 text-xs uppercase tracking-widest disabled:opacity-50"
                                                    >
                                                        {publishing ? <Loader2 size={16} className="animate-spin" /> : <Smartphone size={16} />}
                                                        Publicar en AR
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                                        Escanea el QR con la cámara del teléfono y toca el botón AR
                                                        para colocar el mueble a escala real en tu espacio.
                                                    </p>
                                                    <div className="flex items-center gap-3">
                                                        <a
                                                            href={arUrl(selected.id)} target="_blank" rel="noreferrer"
                                                            className="border border-primary text-primary dark:text-white dark:border-gray-500 px-6 py-3 flex items-center gap-2 text-xs uppercase tracking-widest hover:bg-primary hover:text-white transition-colors"
                                                        >
                                                            <QrCode size={16} /> Abrir visor AR
                                                        </a>
                                                        <button
                                                            onClick={() => publicarAR(selected)}
                                                            disabled={publishing}
                                                            title="Regenerar GLB/USDZ"
                                                            className="text-gray-400 hover:text-primary p-3"
                                                        >
                                                            {publishing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                            <button
                                                onClick={() => borrar(selected)}
                                                className="flex items-center gap-2 text-xs uppercase tracking-widest text-gray-400 hover:text-danger transition-colors pt-2"
                                            >
                                                <Trash2 size={14} /> Eliminar diseño
                                            </button>
                                        </div>
                                        {selected.status === 'published' && qrDataUrl && (
                                            <div className="text-center">
                                                <img src={qrDataUrl} alt="QR visor AR" className="w-40 h-40 border border-gray-200 dark:border-gray-700" />
                                                <p className="text-[10px] font-mono uppercase tracking-widest text-gray-400 mt-2">
                                                    Escanéame
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="h-full min-h-[440px] border border-dashed border-gray-300 dark:border-gray-700 flex flex-col items-center justify-center text-gray-400 text-sm gap-3">
                            <Hammer size={40} className="opacity-30" />
                            Selecciona un diseño o importa un project.json del motor.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Forge;
