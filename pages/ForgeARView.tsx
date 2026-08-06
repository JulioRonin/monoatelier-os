/**
 * Visor AR público — se abre desde el QR del módulo Forge: /?ar=<model_id>
 * No requiere sesión: el cliente (o tú, desde el teléfono) ve el diseño y lo
 * coloca a ESCALA REAL en su espacio.
 *
 *   Android → Scene Viewer / WebXR (usa el GLB)
 *   iOS     → Quick Look (usa el USDZ)
 */
import React, { useEffect, useState } from 'react';
import '@google/model-viewer';
import { Loader2, Smartphone, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { ForgeModel } from '../types';

interface ForgeARViewProps {
    modelId: string;
}

const ForgeARView: React.FC<ForgeARViewProps> = ({ modelId }) => {
    const [model, setModel] = useState<ForgeModel | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.getForgeModel(modelId)
            .then(m => {
                if (!m.glbUrl) setError('Este diseño aún no está publicado en AR.');
                else setModel(m);
            })
            .catch(() => setError('No se encontró el diseño.'));
    }, [modelId]);

    return (
        <div className="fixed inset-0 bg-[#f5f2ec] flex flex-col">
            {/* Marca */}
            <div className="px-6 py-4 flex items-baseline justify-between border-b border-gray-200 bg-white/70 backdrop-blur">
                <div>
                    <h1 className="font-serif text-2xl italic tracking-wider text-[#427a6e]">MONO</h1>
                    <p className="text-[9px] tracking-[0.4em] uppercase text-gray-400">Atelier · Forge AR</p>
                </div>
                {model && (
                    <p className="text-xs font-mono uppercase tracking-widest text-gray-500 text-right">
                        {model.name}
                    </p>
                )}
            </div>

            {error ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-500 px-8 text-center">
                    <AlertTriangle size={40} className="text-amber-500" />
                    <p className="text-sm">{error}</p>
                </div>
            ) : !model ? (
                <div className="flex-1 flex items-center justify-center text-gray-400">
                    <Loader2 size={32} className="animate-spin" />
                </div>
            ) : (
                <>
                    <model-viewer
                        src={model.glbUrl!}
                        ios-src={model.usdzUrl || undefined}
                        alt={model.name}
                        ar
                        ar-modes="webxr scene-viewer quick-look"
                        ar-scale="fixed"
                        ar-placement="floor"
                        camera-controls
                        auto-rotate
                        shadow-intensity="1"
                        style={{ flex: 1, width: '100%' }}
                    />
                    <div className="px-6 py-4 bg-white/70 backdrop-blur border-t border-gray-200 flex items-center gap-3 text-xs text-gray-500">
                        <Smartphone size={16} className="shrink-0 text-[#427a6e]" />
                        <span>
                            Toca el ícono AR (esquina del visor) para colocar el mueble a
                            <b> escala real</b> en tu espacio. Medidas directas del motor mono-forge.
                        </span>
                    </div>
                </>
            )}
        </div>
    );
};

export default ForgeARView;
