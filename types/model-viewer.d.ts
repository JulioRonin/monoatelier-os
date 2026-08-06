// Tipado JSX del custom element <model-viewer> (@google/model-viewer)
import * as React from 'react';

declare module 'react' {
    namespace JSX {
        interface IntrinsicElements {
            'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
                src?: string;
                'ios-src'?: string;
                alt?: string;
                ar?: boolean;
                'ar-modes'?: string;
                'ar-scale'?: string;
                'ar-placement'?: string;
                'camera-controls'?: boolean;
                'auto-rotate'?: boolean;
                'shadow-intensity'?: string | number;
                'environment-image'?: string;
                exposure?: string | number;
                poster?: string;
                loading?: string;
            };
        }
    }
}
