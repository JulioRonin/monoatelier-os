import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { facturapiModo, facturapiPrefijoLlave } from '../lib/facturapi';

/**
 * Aviso global cuando la facturación NO está en producción.
 *
 * Existe por un caso real: la factura A7 de $116,272.80 se timbró en el
 * sandbox de Facturapi porque la llave de Vercel seguía siendo la de pruebas.
 * El CFDI se ve idéntico —PDF, folio fiscal, sello— pero no llega al SAT y el
 * cliente no lo puede deducir. No hay forma de notarlo mirando la factura.
 *
 * Por eso este aviso NO se puede cerrar y sale en todas las páginas: el modo
 * equivocado no se detecta a tiempo si hay que acordarse de revisarlo.
 *
 * En producción no estorba: no se dibuja nada.
 */
const BannerFacturacion: React.FC = () => {
    const modo = facturapiModo();
    if (modo === 'live') return null;

    const esSandbox = modo === 'test';

    return (
        <div
            role="alert"
            className={`flex items-start gap-3 px-6 py-2.5 border-b ${
                esSandbox
                    ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100'
                    : 'bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700 text-red-900 dark:text-red-100'
            }`}
        >
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
                {esSandbox ? (
                    <>
                        <strong className="uppercase tracking-widest">Facturación en modo pruebas</strong>
                        {' — '}
                        lo que timbres aquí <strong>no llega al SAT</strong>, no tiene validez fiscal y
                        el cliente no lo puede deducir, aunque el PDF se vea igual de real.
                        {' '}Para facturar de verdad, pon la llave <code className="font-mono">sk_live_…</code>
                        {' '}en <code className="font-mono">VITE_FACTURAPI_KEY</code> y vuelve a desplegar.
                        <span className="opacity-70"> (llave activa: <code className="font-mono">{facturapiPrefijoLlave()}</code>)</span>
                    </>
                ) : (
                    <>
                        <strong className="uppercase tracking-widest">Sin llave de Facturapi</strong>
                        {' — '}
                        no se puede timbrar ni consultar facturas. Falta
                        {' '}<code className="font-mono">VITE_FACTURAPI_KEY</code> en las variables de
                        entorno de este despliegue.
                    </>
                )}
            </div>
        </div>
    );
};

export default BannerFacturacion;
